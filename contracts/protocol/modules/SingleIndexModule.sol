// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";
import { Uint256ArrayUtil } from "../../lib/Uint256ArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title SingleIndexModule
 *
 * @dev Smart contract that facilitates rebalances for indices. Manager can set target unit amounts, max trade sizes,
 * the exchange to trade on, and the cool down period between trades (on a per asset basis). As currently constructed
 * the module only works for one Set at a time.
 *
 * SECURITY ASSUMPTION:
 *  - Works with following modules: StreamingFeeModule, BasicIssuanceModule (any other module additions to Sets using
      this module need to be examined separately)
 */
contract SingleIndexModule is ModuleBase, ReentrancyGuard {
    using Math for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;
    using PositionUtil for IMatrixToken;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using Uint256ArrayUtil for uint256[];

    // ==================== Enums ====================

    enum ExchangeId {
        None,
        Uniswap,
        Sushiswap,
        Balancer,
        Last
    }

    // ==================== Constants ====================

    uint256 private constant TARGET_RAISE_DIVISOR = 1.0025e18; // Raise targets 25 bps
    uint256 private constant BALANCER_POOL_LIMIT = 3; // Amount of pools examined when fetching quote

    string private constant UNISWAP_OUT = "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)";
    string private constant UNISWAP_IN = "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)";
    string private constant BALANCER_OUT = "smartSwapExactOut(address,address,uint256,uint256,uint256)";
    string private constant BALANCER_IN = "smartSwapExactIn(address,address,uint256,uint256,uint256)";

    // ==================== Structs ====================

    struct AssetTradeInfo {
        uint256 targetUnit; // Target unit for the asset during current rebalance period
        uint256 maxSize; // Max trade size in precise units
        uint256 coolOffPeriod; // Required time between trades for the asset
        uint256 lastTradeTimestamp; // Timestamp of last trade
        uint256 exchange; // Integer representing ID of exchange to use
    }

    // ==================== Variables ====================

    IWETH public _weth; // Weth contract address
    IMatrixToken public _index; // Index being managed with contract

    uint256 public _positionMultiplier; // Position multiplier when current rebalance units were devised

    address public _uniswapRouter; // Uniswap router address
    address public _sushiswapRouter; // Sushiswap router address
    address public _balancerProxy; // Balancer exchange proxy address
    address[] public _rebalanceComponents; // Components having units updated during current rebalance

    bool public _anyoneTrade; // Toggles on or off skipping the _tradeAllows

    mapping(address => AssetTradeInfo) public _tradeInfos; // Mapping of component to component restrictions
    mapping(address => bool) public _tradeAllows; // Mapping of addresses allowed to call trade()

    /* ============ Events ============ */

    event UpdateTargetUnits(address indexed component, uint256 newUnit, uint256 positionMultiplier);
    event UpdateTradeMaximum(address indexed component, uint256 newMaximum);
    event UpdateAssetExchange(address indexed component, uint256 newExchange);
    event UpdateCoolOffPeriod(address indexed component, uint256 newCoolOffPeriod);
    event UpdateTraderStatus(address indexed trader, bool status);
    event UpdateAnyoneTrade(bool indexed status);
    event ExecuteTrade(address indexed executor, address indexed sellComponent, address indexed buyComponent, uint256 amountSold, uint256 amountBought);

    // ==================== Constructor function ====================

    constructor(
        IController controller,
        IWETH weth,
        address uniswapRouter,
        address sushiswapRouter,
        address balancerProxy,
        string memory name
    ) ModuleBase(controller, name) {
        _weth = weth;
        _uniswapRouter = uniswapRouter;
        _sushiswapRouter = sushiswapRouter;
        _balancerProxy = balancerProxy;
    }

    // ==================== Modifier functions ====================

    modifier onlyAllowedTrader(address caller) {
        _onlyAllowedTrader(caller);
        _;
    }

    modifier onlyEOA() {
        _onlyEOA();
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev Get target units for passed components, normalized to current positionMultiplier.
     *
     * @param components    Array of components to get target units for
     *
     * @return uint256[]    Array of targetUnits mapping to passed components
     */
    function getTargetUnits(address[] calldata components) external view returns (uint256[] memory) {
        uint256 currentPositionMultiplier = _index.getPositionMultiplier().toUint256();
        uint256[] memory targetUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            targetUnits[i] = _normalizeTargetUnit(components[i], currentPositionMultiplier);
        }

        return targetUnits;
    }

    function getRebalanceComponents() external view returns (address[] memory) {
        return _rebalanceComponents;
    }

    /**
     * @dev MANAGER ONLY: Set new target units, zeroing out any units for components being removed from index. Log position multiplier to
     * adjust target units in case fees are accrued. Validate that _weth is not a part of the new allocation and that all components
     * in current allocation are in components array.
     *
     * @param newComponents               New components to add to allocation
     * @param newComponentsTargetUnits    Target units at end of rebalance for new components, maps to same index of component
     * @param oldComponentsTargetUnits    Target units at end of rebalance for old component, maps to same index of component, if component being removed set to 0.
     * @param positionMultiplier          Position multiplier when target units were calculated, needed in order to adjust target units if fees accrued
     */
    function startRebalance(
        address[] calldata newComponents,
        uint256[] calldata newComponentsTargetUnits,
        uint256[] calldata oldComponentsTargetUnits,
        uint256 positionMultiplier
    ) external onlyManagerAndValidMatrix(_index) {
        // Don't use validate arrays because empty arrays are valid
        require(newComponents.length == newComponentsTargetUnits.length, "S0a");

        address[] memory currentComponents = _index.getComponents();
        require(currentComponents.length == oldComponentsTargetUnits.length, "S0b");

        address[] memory aggregateComponents = currentComponents.merge(newComponents);
        uint256[] memory aggregateTargetUnits = oldComponentsTargetUnits.merge(newComponentsTargetUnits);

        require(!aggregateComponents.hasDuplicate(), "S0c");

        for (uint256 i = 0; i < aggregateComponents.length; i++) {
            address component = aggregateComponents[i];
            uint256 targetUnit = aggregateTargetUnits[i];

            require(address(component) != address(_weth), "S0d");
            _tradeInfos[component].targetUnit = targetUnit;

            emit UpdateTargetUnits(component, targetUnit, positionMultiplier);
        }

        _rebalanceComponents = aggregateComponents;
        _positionMultiplier = positionMultiplier;
    }

    /**
     * @dev ACCESS LIMITED: Only approved addresses can call if _anyoneTrade is false. Determines trade size
     * and direction and swaps into or out of WETH on exchange specified by manager.
     *
     * @param component    Component to trade
     */
    function trade(address component) external virtual nonReentrant onlyAllowedTrader(msg.sender) onlyEOA {
        _validateTradeParameters(component);

        (bool isBuy, uint256 tradeAmount) = _calculateTradeSizeAndDirection(component);

        if (isBuy) {
            _buyUnderweight(component, tradeAmount);
        } else {
            _sellOverweight(component, tradeAmount);
        }

        _tradeInfos[component].lastTradeTimestamp = block.timestamp;
    }

    /**
     * @dev ACCESS LIMITED: Only approved addresses can call if _anyoneTrade is false. Only callable when 1) there are no
     * more components to be sold and, 2) entire remaining WETH amount can be traded such that resulting inflows won't
     * exceed components maxTradeSize nor overshoot the target unit. To be used near the end of rebalances when a
     * component's calculated trade size is greater in value than remaining WETH.
     *
     * @param component    Component to trade
     */
    function tradeRemainingWETH(address component) external virtual nonReentrant onlyAllowedTrader(msg.sender) onlyEOA {
        require(_noTokensToSell(), "S1a");
        _validateTradeParameters(component);

        (, uint256 tradeLimit) = _calculateTradeSizeAndDirection(component);
        uint256 preTradeComponentAmount = IERC20(component).balanceOf(address(_index));
        uint256 preTradeWethAmount = _weth.balanceOf(address(_index));
        _executeTrade(address(_weth), component, true, preTradeWethAmount, _tradeInfos[component].exchange);
        (, uint256 componentTradeSize) = _updatePositionState(address(_weth), component, preTradeWethAmount, preTradeComponentAmount);

        require(componentTradeSize < tradeLimit, "S1b");

        _tradeInfos[component].lastTradeTimestamp = block.timestamp;
    }

    /**
     * @dev ACCESS LIMITED: For situation where all target units met and remaining WETH, uniformly raise targets by same
     * percentage in order to allow further trading. Can be called multiple times if necessary, increase should be
     * small in order to reduce tracking error.
     */
    function raiseAssetTargets() external virtual nonReentrant onlyAllowedTrader(msg.sender) {
        require(_allTargetsMet() && _index.getDefaultPositionRealUnit(address(_weth)) > 0, "S2");

        _positionMultiplier = _positionMultiplier.preciseDiv(TARGET_RAISE_DIVISOR);
    }

    /**
     * @dev MANAGER ONLY: Set trade maximums for passed components
     *
     * @param components       Array of components
     * @param tradeMaximums    Array of trade maximums mapping to correct component
     */
    function setTradeMaximums(address[] calldata components, uint256[] calldata tradeMaximums) external onlyManagerAndValidMatrix(_index) {
        _validateArrays(components, tradeMaximums);

        for (uint256 i = 0; i < components.length; i++) {
            _tradeInfos[components[i]].maxSize = tradeMaximums[i];

            emit UpdateTradeMaximum(components[i], tradeMaximums[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Set exchange for passed components
     *
     * @param components    Array of components
     * @param exchanges     Array of exchanges mapping to correct component, uint256 used to signify exchange
     */
    function setExchanges(address[] calldata components, uint256[] calldata exchanges) external onlyManagerAndValidMatrix(_index) {
        _validateArrays(components, exchanges);

        for (uint256 i = 0; i < components.length; i++) {
            uint256 exchange = exchanges[i];
            require(exchange < uint256(ExchangeId.Last), "S3");
            _tradeInfos[components[i]].exchange = exchanges[i];

            emit UpdateAssetExchange(components[i], exchange);
        }
    }

    /**
     * @dev MANAGER ONLY: Set exchange for passed components
     *
     * @param components        Array of components
     * @param coolOffPeriods    Array of cool off periods to correct component
     */
    function setCoolOffPeriods(address[] calldata components, uint256[] calldata coolOffPeriods) external onlyManagerAndValidMatrix(_index) {
        _validateArrays(components, coolOffPeriods);

        for (uint256 i = 0; i < components.length; i++) {
            _tradeInfos[components[i]].coolOffPeriod = coolOffPeriods[i];

            emit UpdateCoolOffPeriod(components[i], coolOffPeriods[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Toggle ability for passed addresses to trade from current state
     *
     * @param traders     Array trader addresses to toggle status
     * @param statuses    Booleans indicating if matching trader can trade
     */
    function updateTraderStatus(address[] calldata traders, bool[] calldata statuses) external onlyManagerAndValidMatrix(_index) {
        require(traders.length == statuses.length, "S4a");
        require(traders.length > 0, "S4b");
        require(!traders.hasDuplicate(), "S4c");

        for (uint256 i = 0; i < traders.length; i++) {
            address trader = traders[i];
            bool status = statuses[i];
            _tradeAllows[trader] = status;

            emit UpdateTraderStatus(trader, status);
        }
    }

    /**
     * @dev MANAGER ONLY: Toggle whether anyone can trade, bypassing the traderAllowList
     *
     * @param status    Boolean indicating if anyone can trade
     */
    function updateAnyoneTrade(bool status) external onlyManagerAndValidMatrix(_index) {
        _anyoneTrade = status;

        emit UpdateAnyoneTrade(status);
    }

    /**
     * @dev MANAGER ONLY: Set target units to current units and last trade to zero. Initialize module.
     *
     * @param index    Address of index being used for this Set
     */
    function initialize(IMatrixToken index) external onlyMatrixManager(index, msg.sender) onlyValidAndPendingMatrix(index) {
        require(address(_index) == address(0), "S5");

        IMatrixToken.Position[] memory positions = index.getPositions();

        for (uint256 i = 0; i < positions.length; i++) {
            IMatrixToken.Position memory position = positions[i];
            _tradeInfos[position.component].targetUnit = position.unit.toUint256();
            _tradeInfos[position.component].lastTradeTimestamp = 0;
        }

        _index = index;
        index.initializeModule();
    }

    function removeModule() external override {}

    // ==================== Internal functions ====================

    /**
     * @dev Validate that enough time has elapsed since component's last trade and component isn't WETH.
     */
    function _validateTradeParameters(address component) internal view virtual {
        require(_rebalanceComponents.contain(component), "S6a");

        AssetTradeInfo storage componentInfo = _tradeInfos[component];

        require(componentInfo.exchange != uint256(ExchangeId.None), "S6b");
        require(componentInfo.lastTradeTimestamp + componentInfo.coolOffPeriod <= block.timestamp, "S6c");
    }

    /**
     * @dev Calculate trade size and whether trade is buy. Trade size is the minimum of the max size and components left to trade.
     * Reverts if target quantity is already met. Target unit is adjusted based on ratio of position multiplier when target was defined
     * and the current positionMultiplier.
     */
    function _calculateTradeSizeAndDirection(address component) internal view returns (bool isBuy, uint256) {
        uint256 totalSupply = _index.totalSupply();
        uint256 componentMaxSize = _tradeInfos[component].maxSize;
        uint256 currentPositionMultiplier = _index.getPositionMultiplier().toUint256();
        uint256 currentUnit = _index.getDefaultPositionRealUnit(component).toUint256();
        uint256 targetUnit = _normalizeTargetUnit(component, currentPositionMultiplier);

        require(currentUnit != targetUnit, "S7");

        uint256 currentNotional = PositionUtil.getDefaultTotalNotional(totalSupply, currentUnit);
        uint256 targetNotional = totalSupply.preciseMulCeil(targetUnit);

        return
            targetNotional > currentNotional
                ? (true, componentMaxSize.min(targetNotional - currentNotional))
                : (false, componentMaxSize.min(currentNotional - targetNotional));
    }

    /**
     * @dev Buy an underweight asset by selling an unfixed amount of WETH for a fixed amount of the component.
     */
    function _buyUnderweight(address component, uint256 amount) internal {
        uint256 preTradeBuyComponentAmount = IERC20(component).balanceOf(address(_index));
        uint256 preTradeSellComponentAmount = _weth.balanceOf(address(_index));

        _executeTrade(address(_weth), component, false, amount, _tradeInfos[component].exchange);
        _updatePositionState(address(_weth), component, preTradeSellComponentAmount, preTradeBuyComponentAmount);
    }

    /**
     * @dev Sell an overweight asset by selling a fixed amount of component for an unfixed amount of WETH.
     */
    function _sellOverweight(address component, uint256 amount) internal {
        uint256 preTradeBuyComponentAmount = _weth.balanceOf(address(_index));
        uint256 preTradeSellComponentAmount = IERC20(component).balanceOf(address(_index));

        _executeTrade(component, address(_weth), true, amount, _tradeInfos[component].exchange);
        _updatePositionState(component, address(_weth), preTradeSellComponentAmount, preTradeBuyComponentAmount);
    }

    /**
     * @dev Determine parameters for trade and invoke trade on index using correct exchange.
     */
    function _executeTrade(
        address sellComponent,
        address buyComponent,
        bool fixIn,
        uint256 amount,
        uint256 exchange
    ) internal virtual {
        uint256 wethBalance = _weth.balanceOf(address(_index));

        (address exchangeAddress, bytes memory tradeCallData) = (exchange == uint256(ExchangeId.Balancer))
            ? _getBalancerTradeData(sellComponent, buyComponent, fixIn, amount, wethBalance)
            : _getUniswapLikeTradeData(sellComponent, buyComponent, fixIn, amount, exchange);

        uint256 approveAmount = (sellComponent == address(_weth)) ? wethBalance : amount;
        _index.invokeSafeIncreaseAllowance(sellComponent, exchangeAddress, approveAmount);
        _index.invoke(exchangeAddress, 0, tradeCallData);
    }

    /**
     * @dev Update position units on _index. Emit event.
     */
    function _updatePositionState(
        address sellComponent,
        address buyComponent,
        uint256 _preTradeSellComponentAmount,
        uint256 _preTradeBuyComponentAmount
    ) internal returns (uint256 sellAmount, uint256 buyAmount) {
        uint256 totalSupply = _index.totalSupply();

        (uint256 postTradeSellComponentAmount, , ) = _index.calculateAndEditDefaultPosition(sellComponent, totalSupply, _preTradeSellComponentAmount);
        (uint256 postTradeBuyComponentAmount, , ) = _index.calculateAndEditDefaultPosition(buyComponent, totalSupply, _preTradeBuyComponentAmount);

        sellAmount = _preTradeSellComponentAmount - postTradeSellComponentAmount;
        buyAmount = postTradeBuyComponentAmount - _preTradeBuyComponentAmount;

        emit ExecuteTrade(msg.sender, sellComponent, buyComponent, sellAmount, buyAmount);
    }

    /**
     * @dev Create Balancer trade call data
     */
    function _getBalancerTradeData(
        address sellComponent,
        address buyComponent,
        bool fixIn,
        uint256 amount,
        uint256 _maxOut
    ) internal view returns (address, bytes memory) {
        address exchangeAddress = _balancerProxy;
        (string memory functionSignature, uint256 limit) = fixIn ? (BALANCER_IN, 1) : (BALANCER_OUT, _maxOut);

        bytes memory tradeCallData = abi.encodeWithSignature(functionSignature, sellComponent, buyComponent, amount, limit, BALANCER_POOL_LIMIT);

        return (exchangeAddress, tradeCallData);
    }

    /**
     * @dev Determine whether exchange to call is Uniswap or Sushiswap and generate necessary call data.
     */
    function _getUniswapLikeTradeData(
        address sellComponent,
        address buyComponent,
        bool fixIn,
        uint256 amount,
        uint256 exchange
    ) internal view returns (address, bytes memory) {
        address exchangeAddress = (exchange == uint256(ExchangeId.Uniswap)) ? _uniswapRouter : _sushiswapRouter;

        string memory functionSignature;
        address[] memory path = new address[](2);
        uint256 limit;

        if (fixIn) {
            functionSignature = UNISWAP_IN;
            limit = 1;
        } else {
            functionSignature = UNISWAP_OUT;
            limit = PreciseUnitMath.maxUint256();
        }

        path[0] = sellComponent;
        path[1] = buyComponent;

        bytes memory tradeCallData = abi.encodeWithSignature(functionSignature, amount, limit, path, address(_index), block.timestamp + 180);

        return (exchangeAddress, tradeCallData);
    }

    /**
     * @dev Check if there are any more tokens to sell.
     */
    function _noTokensToSell() internal view returns (bool) {
        uint256 currentPositionMultiplier = _index.getPositionMultiplier().toUint256();

        for (uint256 i = 0; i < _rebalanceComponents.length; i++) {
            address component = _rebalanceComponents[i];
            // bool canSell = _normalizeTargetUnit(component, currentPositionMultiplier) < _index.getDefaultPositionRealUnit(component).toUint256();
            if (_normalizeTargetUnit(component, currentPositionMultiplier) < _index.getDefaultPositionRealUnit(component).toUint256()) {
                return false;
            }
        }

        return true;
    }

    /**
     * @dev Check if all targets are met
     */
    function _allTargetsMet() internal view returns (bool) {
        uint256 currentPositionMultiplier = _index.getPositionMultiplier().toUint256();

        for (uint256 i = 0; i < _rebalanceComponents.length; i++) {
            address component = _rebalanceComponents[i];
            // bool targetUnmet = _normalizeTargetUnit(component, currentPositionMultiplier) != _index.getDefaultPositionRealUnit(component).toUint256();
            if (_normalizeTargetUnit(component, currentPositionMultiplier) != _index.getDefaultPositionRealUnit(component).toUint256()) {
                return false;
            }
        }
        return true;
    }

    /**
     * @dev Normalize target unit to current position multiplier in case fees have been accrued.
     */
    function _normalizeTargetUnit(address component, uint256 currentPositionMultiplier) internal view returns (uint256) {
        return (_tradeInfos[component].targetUnit * currentPositionMultiplier) / _positionMultiplier;
    }

    /**
     * @dev Validate arrays are of equal length and not empty.
     */
    function _validateArrays(address[] calldata components, uint256[] calldata data) internal pure {
        require(components.length == data.length, "S8a");
        require(components.length > 0, "S8b");
        require(!components.hasDuplicate(), "S8c");
    }

    // ==================== Private functions ====================

    function _onlyAllowedTrader(address caller) private view {
        require(_anyoneTrade || _tradeAllows[caller], "S9");
    }

    function _onlyEOA() private view {
        require(msg.sender == tx.origin, "S10");
    }
}
