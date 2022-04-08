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
import { IIndexExchangeAdapter } from "../../interfaces/IIndexExchangeAdapter.sol";

/**
 * @title GeneralIndexModule
 *
 * @dev Smart contract that facilitates rebalances for indices. Manager can update allocation by calling startRebalance().
 * There is no "end" to a rebalance, however once there are no more tokens to sell the rebalance is effectively over
 * until the manager calls startRebalance() again with a new allocation. Once a new allocation is passed in, allowed
 * traders can submit rebalance transactions by calling trade() and specifying the component they wish to rebalance.
 * All parameterizations for a trade are set by the manager ahead of time, including max trade size, coolOffPeriod bet-
 * ween trades, and exchange to trade on. WETH is used as the quote asset for all trades, near the end of rebalance
 * tradeRemaingingWETH() or raiseAssetTargets() can be called to clean up any excess WETH positions. Once a component's
 * target allocation is met any further attempted trades of that component will revert.
 *
 * SECURITY ASSUMPTION:
 *  - Works with following modules: StreamingFeeModule, BasicIssuanceModule (any other module additions to MatrixToken using
 *    this module need to be examined separately)
 */
contract GeneralIndexModule is ModuleBase, ReentrancyGuard {
    using Math for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;
    using PositionUtil for IMatrixToken;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using AddressArrayUtil for IERC20[];
    using Uint256ArrayUtil for uint256[];

    // ==================== Constants ====================

    uint256 private constant GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX = 0; // Id of protocol fee % assigned to this module in the Controller

    // ==================== Structs ====================

    struct TradeExecutionParams {
        uint256 targetUnit; // Target unit of component for Matrix
        uint256 maxSize; // Max trade size in precise units
        uint256 coolOffPeriod; // Required time between trades for the asset
        uint256 lastTradeTimestamp; // Timestamp of last trade
        string exchangeName; // Name of exchange adapter
        bytes exchangeData; // Arbitrary data that can be used to encode exchange specific settings (fee tier) or features (multi-hop)
    }

    struct TradePermissionInfo {
        bool anyoneTrade; // Boolean indicating if anyone can execute a trade
        address[] tradersHistory; // Tracks permissioned traders to be deleted on module removal
        mapping(address => bool) tradeAllowList; // Mapping indicating which addresses are allowed to execute trade
    }

    struct RebalanceInfo {
        uint256 positionMultiplier; // Position multiplier at the beginning of rebalance
        uint256 raiseTargetPercentage; // Amount to raise all unit targets by if allowed (in precise units)
        address[] rebalanceComponents; // Array of components involved in rebalance
    }

    struct TradeInfo {
        uint256 matrixTotalSupply; // Total supply of Matrix (in precise units)
        uint256 totalFixedQuantity; // Total quantity of fixed asset being traded
        uint256 sendQuantity; // Units of component sent to the exchange
        uint256 floatingQuantityLimit; // Max/min amount of floating token spent/received during trade
        uint256 preTradeSendTokenBalance; // Total initial balance of token being sold
        uint256 preTradeReceiveTokenBalance; // Total initial balance of token being bought
        address sendToken; // Address of token being sold
        address receiveToken; // Address of token being bought
        IMatrixToken matrixToken; // Instance of MatrixToken
        IIndexExchangeAdapter exchangeAdapter; // Instance of Exchange Adapter
        bool isSendTokenFixed; // Boolean indicating fixed asset is send token
        bytes exchangeData; // Arbitrary data for executing trade on given exchange
    }

    // ==================== Variables ====================

    IWETH public immutable _weth; // Weth contract address
    mapping(IMatrixToken => mapping(IERC20 => TradeExecutionParams)) public _executionInfos; // Mapping of MatrixToken to execution parameters of each asset on MatrixToken
    mapping(IMatrixToken => TradePermissionInfo) public _permissionInfos; // Mapping of MatrixToken to trading permissions
    mapping(IMatrixToken => RebalanceInfo) public _rebalanceInfos; // Mapping of MatrixToken to relevant data for current rebalance

    // ==================== Events ====================

    event UpdateTradeMaximum(IMatrixToken indexed matrixToken, address indexed component, uint256 newMaximum);
    event UpdateAssetExchange(IMatrixToken indexed matrixToken, address indexed component, string newExchangeName);
    event UpdateCoolOffPeriod(IMatrixToken indexed matrixToken, address indexed component, uint256 newCoolOffPeriod);
    event UpdateExchangeData(IMatrixToken indexed matrixToken, address indexed component, bytes newExchangeData);
    event UpdateRaiseTargetPercentage(IMatrixToken indexed matrixToken, uint256 indexed raiseTargetPercentage);
    event RaiseAssetTargets(IMatrixToken indexed matrixToken, uint256 indexed positionMultiplier);
    event AnyoneTradeUpdated(IMatrixToken indexed matrixToken, bool indexed status);
    event TraderStatusUpdated(IMatrixToken indexed matrixToken, address indexed trader, bool status);
    event StartRebalance(IMatrixToken indexed matrixToken, address[] aggregateComponents, uint256[] aggregateTargetUnits, uint256 indexed positionMultiplier);

    event ExecuteTrade(
        IMatrixToken indexed matrixToken,
        address indexed sellComponent,
        address indexed buyComponent,
        IIndexExchangeAdapter exchangeAdapter,
        address executor,
        uint256 netAmountSold,
        uint256 netAmountReceived,
        uint256 protocolFee
    );

    // ==================== Constructor function ====================

    constructor(
        IController controller,
        IWETH weth,
        string memory name
    ) ModuleBase(controller, name) {
        _weth = weth;
    }

    // ==================== Modifier functions ====================

    modifier onlyAllowedTrader(IMatrixToken matrixToken) {
        _validateOnlyAllowedTrader(matrixToken);
        _;
    }

    modifier onlyEOAIfUnrestricted(IMatrixToken matrixToken) {
        _validateOnlyEOAIfUnrestricted(matrixToken);
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev Get the array of MatrixToken components involved in rebalance.
     *
     * @param matrixToken    Address of the MatrixToken
     *
     * @return address[]     Array of matrixToken components involved in rebalance
     */
    function getRebalanceComponents(IMatrixToken matrixToken) external view onlyValidAndInitializedMatrix(matrixToken) returns (address[] memory) {
        return _rebalanceInfos[matrixToken].rebalanceComponents;
    }

    /**
     * @dev Calculates the amount of a component that is going to be traded and whether the component
     * is being bought or sold. If currentUnit and targetUnit are the same, function will revert.
     *
     * @param matrixToken           Instance of the MatrixToken to rebalance
     * @param component             IERC20 component to trade
     *
     * @return isSendTokenFixed     Boolean indicating fixed asset is send token
     * @return componentQuantity    Amount of component being traded
     */
    function getComponentTradeQuantityAndDirection(IMatrixToken matrixToken, IERC20 component)
        external
        view
        onlyValidAndInitializedMatrix(matrixToken)
        returns (bool, uint256)
    {
        require(_rebalanceInfos[matrixToken].rebalanceComponents.contain(address(component)), "G0");

        uint256 totalSupply = matrixToken.totalSupply();

        return _calculateTradeSizeAndDirection(matrixToken, component, totalSupply);
    }

    /**
     * @dev Get if a given address is an allowed trader.
     *
     * @param matrixToken    Address of the MatrixToken
     * @param trader         Address of the trader
     *
     * @return bool          True if trader is allowed to trade, else false
     */
    function getIsAllowedTrader(IMatrixToken matrixToken, address trader) external view onlyValidAndInitializedMatrix(matrixToken) returns (bool) {
        return _isAllowedTrader(matrixToken, trader);
    }

    /**
     * @dev Get the list of traders who are allowed to call trade(), tradeRemainingWeth(), and raiseAssetTarget()
     *
     * @param matrixToken    Address of the MatrixToken
     */
    function getAllowedTraders(IMatrixToken matrixToken) external view onlyValidAndInitializedMatrix(matrixToken) returns (address[] memory) {
        return _permissionInfos[matrixToken].tradersHistory;
    }

    /**
     * @dev MANAGER ONLY: Changes the target allocation of the Matrix, opening it up for trading by the MatrixToken designated traders. The manager
     * must pass in any new components and their target units (units defined by the amount of that component the manager wants in 10**18
     * units of a MatrixToken). Old component target units must be passed in, in the current order of the components array on the
     * MatrixToken. If a component is being removed it's index in the oldComponentsTargetUnits should be set to 0. Additionally, the
     * positionMultiplier is passed in, in order to adjust the target units in the event fees are accrued or some other activity occurs
     * that changes the positionMultiplier of the Matrix. This guarantees the same relative allocation between all the components.
     *
     * @param matrixToken                 Address of the MatrixToken to be rebalanced
     * @param newComponents               New components to add to allocation
     * @param newComponentsTargetUnits    Target units at end of rebalance for new components, maps to same index of newComponents array
     * @param oldComponentsTargetUnits    Target units at end of rebalance for old component, maps to same index of matrixToken.getComponents() array, if component being removed set to 0.
     * @param positionMultiplier          Position multiplier when target units were calculated, needed in order to adjust target units if fees accrued
     */
    function startRebalance(
        IMatrixToken matrixToken,
        address[] calldata newComponents,
        uint256[] calldata newComponentsTargetUnits,
        uint256[] calldata oldComponentsTargetUnits,
        uint256 positionMultiplier
    ) external onlyManagerAndValidMatrix(matrixToken) {
        (address[] memory aggregateComponents, uint256[] memory aggregateTargetUnits) = _getAggregateComponentsAndUnits(
            matrixToken.getComponents(),
            newComponents,
            newComponentsTargetUnits,
            oldComponentsTargetUnits
        );

        for (uint256 i = 0; i < aggregateComponents.length; i++) {
            require(!matrixToken.hasExternalPosition(aggregateComponents[i]), "G1");
            _executionInfos[matrixToken][IERC20(aggregateComponents[i])].targetUnit = aggregateTargetUnits[i];
        }

        _rebalanceInfos[matrixToken].rebalanceComponents = aggregateComponents;
        _rebalanceInfos[matrixToken].positionMultiplier = positionMultiplier;

        emit StartRebalance(matrixToken, aggregateComponents, aggregateTargetUnits, positionMultiplier);
    }

    /**
     * @dev ACCESS LIMITED: Calling trade() pushes the current component units closer to the target units defined by the manager in startRebalance().
     * Only approved addresses can call, if anyoneTrade is false then contracts are allowed to call otherwise calling address must be EOA.
     *
     * Trade can be called at anytime but will revert if the passed component's target unit is met or cool off period hasn't passed. Trader can pass
     * in a max/min amount of ETH spent/received in the trade based on if the component is being bought/sold in order to prevent sandwich attacks.
     * The parameters defined by the manager are used to determine which exchange will be used and the size of the trade. Trade size will default
     * to max trade size unless the max trade size would exceed the target, then an amount that would match the target unit is traded. Protocol fees,
     * if enabled, are collected in the token received in a trade.
     *
     * @param matrixToken         Address of the MatrixToken
     * @param component           Address of MatrixToken component to trade
     * @param ethQuantityLimit    Max/min amount of ETH spent/received during trade
     */
    function trade(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 ethQuantityLimit
    ) external virtual nonReentrant onlyAllowedTrader(matrixToken) onlyEOAIfUnrestricted(matrixToken) {
        _validateTradeParameters(matrixToken, component);
        TradeInfo memory tradeInfo = _createTradeInfo(matrixToken, component, ethQuantityLimit);
        _executeTrade(tradeInfo);
        uint256 protocolFee = _accrueProtocolFee(tradeInfo);
        (uint256 netSendAmount, uint256 netReceiveAmount) = _updatePositionStateAndTimestamp(tradeInfo, component);

        emit ExecuteTrade(
            tradeInfo.matrixToken,
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            tradeInfo.exchangeAdapter,
            msg.sender,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }

    /**
     * @dev ACCESS LIMITED: Only callable when 1) there are no more components to be sold and, 2) entire remaining WETH amount (above WETH target) can be
     * traded such that resulting inflows won't exceed component's maxTradeSize nor overshoot the target unit. To be used near the end of rebalances
     * when a component's calculated trade size is greater in value than remaining WETH.
     *
     * Only approved addresses can call, if anyoneTrade is false then contracts are allowed to call otherwise calling address must be EOA. Trade
     * can be called at anytime but will revert if the passed component's target unit is met or cool off period hasn't passed. Like with trade()
     * a minimum component receive amount can be set.
     *
     * @param matrixToken             Address of the MatrixToken
     * @param component               Address of the MatrixToken component to trade
     * @param minComponentReceived    Min amount of component received during trade
     */
    function tradeRemainingWETH(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 minComponentReceived
    ) external virtual nonReentrant onlyAllowedTrader(matrixToken) onlyEOAIfUnrestricted(matrixToken) {
        require(_noTokensToSell(matrixToken), "G2a");
        require(_executionInfos[matrixToken][_weth].targetUnit < _getDefaultPositionRealUnit(matrixToken, _weth), "G2b");

        _validateTradeParameters(matrixToken, component);
        TradeInfo memory tradeInfo = _createTradeRemainingInfo(matrixToken, component, minComponentReceived);
        _executeTrade(tradeInfo);
        uint256 protocolFee = _accrueProtocolFee(tradeInfo);
        (uint256 netSendAmount, uint256 netReceiveAmount) = _updatePositionStateAndTimestamp(tradeInfo, component);

        require(netReceiveAmount + protocolFee < _executionInfos[matrixToken][component].maxSize, "G2c");

        _validateComponentPositionUnit(matrixToken, component);

        emit ExecuteTrade(
            tradeInfo.matrixToken,
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            tradeInfo.exchangeAdapter,
            msg.sender,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }

    /**
     * @dev ACCESS LIMITED: For situation where all target units met and remaining WETH, uniformly raise targets by same percentage by applying
     * to logged positionMultiplier in RebalanceInfo struct, in order to allow further trading. Can be called multiple times if necessary,
     * targets are increased by amount specified by raiseAssetTargetsPercentage as set by manager. In order to reduce tracking error
     * raising the target by a smaller amount allows greater granularity in finding an equilibrium between the excess ETH and components
     * that need to be bought. Raising the targets too much could result in vastly under allocating to WETH as more WETH than necessary is
     * spent buying the components to meet their new target.
     *
     * @param matrixToken    Address of the MatrixToken
     */
    function raiseAssetTargets(IMatrixToken matrixToken) external virtual onlyAllowedTrader(matrixToken) {
        require(_allTargetsMet(matrixToken) && _getDefaultPositionRealUnit(matrixToken, _weth) > _getNormalizedTargetUnit(matrixToken, _weth), "G3");

        // positionMultiplier / (10^18 + raiseTargetPercentage)
        // ex: (10 ** 18) / ((10 ** 18) + ether(.0025)) => 997506234413965087
        _rebalanceInfos[matrixToken].positionMultiplier = _rebalanceInfos[matrixToken].positionMultiplier.preciseDiv(
            PreciseUnitMath.preciseUnit() + _rebalanceInfos[matrixToken].raiseTargetPercentage
        );

        emit RaiseAssetTargets(matrixToken, _rebalanceInfos[matrixToken].positionMultiplier);
    }

    /**
     * @dev MANAGER ONLY: Set trade maximums for passed components of the MatrixToken. Can be called at anytime.
     * @notice Trade maximums must be set before rebalance can begin properly - they are zero by default and
     * trades will not execute if a component's trade size is greater than the maximum.
     *
     * @param matrixToken      Address of the MatrixToken
     * @param components       Array of components
     * @param tradeMaximums    Array of trade maximums mapping to correct component
     */
    function setTradeMaximums(
        IMatrixToken matrixToken,
        address[] memory components,
        uint256[] memory tradeMaximums
    ) external onlyManagerAndValidMatrix(matrixToken) {
        components.validateArrayPairs(tradeMaximums);

        for (uint256 i = 0; i < components.length; i++) {
            _executionInfos[matrixToken][IERC20(components[i])].maxSize = tradeMaximums[i];
            emit UpdateTradeMaximum(matrixToken, components[i], tradeMaximums[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Set exchange for passed components of the MatrixToken. Can be called at anytime.
     *
     * @param matrixToken      Address of the MatrixToken
     * @param components       Array of components
     * @param exchangeNames    Array of exchange names mapping to correct component
     */
    function setExchanges(
        IMatrixToken matrixToken,
        address[] memory components,
        string[] memory exchangeNames
    ) external onlyManagerAndValidMatrix(matrixToken) {
        components.validateArrayPairs(exchangeNames);

        for (uint256 i = 0; i < components.length; i++) {
            if (components[i] != address(_weth)) {
                require(_controller.getIntegrationRegistry().isValidIntegration(address(this), exchangeNames[i]), "G4");

                _executionInfos[matrixToken][IERC20(components[i])].exchangeName = exchangeNames[i];

                emit UpdateAssetExchange(matrixToken, components[i], exchangeNames[i]);
            }
        }
    }

    /**
     * @dev MANAGER ONLY: Set cool off periods for passed components of the MatrixToken. Can be called at any time.
     *
     * @param matrixToken       Address of the MatrixToken
     * @param components        Array of components
     * @param coolOffPeriods    Array of cool off periods to correct component
     */
    function setCoolOffPeriods(
        IMatrixToken matrixToken,
        address[] memory components,
        uint256[] memory coolOffPeriods
    ) external onlyManagerAndValidMatrix(matrixToken) {
        components.validateArrayPairs(coolOffPeriods);

        for (uint256 i = 0; i < components.length; i++) {
            _executionInfos[matrixToken][IERC20(components[i])].coolOffPeriod = coolOffPeriods[i];

            emit UpdateCoolOffPeriod(matrixToken, components[i], coolOffPeriods[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Set arbitrary byte data on a per asset basis that can be used to pass exchange specific settings
     * (i.e. specifying fee tiers) or exchange specific features (enabling multi-hop trades). Can be called at any time.
     *
     * @param matrixToken     Address of the MatrixToken
     * @param components      Array of components
     * @param exchangeData    Array of exchange specific arbitrary bytes data
     */
    function setExchangeData(
        IMatrixToken matrixToken,
        address[] memory components,
        bytes[] memory exchangeData
    ) external onlyManagerAndValidMatrix(matrixToken) {
        components.validateArrayPairs(exchangeData);

        for (uint256 i = 0; i < components.length; i++) {
            _executionInfos[matrixToken][IERC20(components[i])].exchangeData = exchangeData[i];

            emit UpdateExchangeData(matrixToken, components[i], exchangeData[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Set amount by which all component's targets units would be raised. Can be called at any time.
     *
     * @param matrixToken              Address of the MatrixToken
     * @param raiseTargetPercentage    Amount to raise all component's unit targets by (in precise units)
     */
    function setRaiseTargetPercentage(IMatrixToken matrixToken, uint256 raiseTargetPercentage) external onlyManagerAndValidMatrix(matrixToken) {
        require(raiseTargetPercentage > 0, "G5");

        _rebalanceInfos[matrixToken].raiseTargetPercentage = raiseTargetPercentage;

        emit UpdateRaiseTargetPercentage(matrixToken, raiseTargetPercentage);
    }

    /**
     * @dev MANAGER ONLY: Toggles ability for passed addresses to call trade() or tradeRemainingWETH(). Can be called at any time.
     *
     * @param matrixToken    Address of the MatrixToken
     * @param traders        Array trader addresses to toggle status
     * @param statuses       Booleans indicating if matching trader can trade
     */
    function setTraderStatus(
        IMatrixToken matrixToken,
        address[] memory traders,
        bool[] memory statuses
    ) external onlyManagerAndValidMatrix(matrixToken) {
        traders.validateArrayPairs(statuses);

        for (uint256 i = 0; i < traders.length; i++) {
            _updateTradersHistory(matrixToken, traders[i], statuses[i]);
            _permissionInfos[matrixToken].tradeAllowList[traders[i]] = statuses[i];

            emit TraderStatusUpdated(matrixToken, traders[i], statuses[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Toggle whether anyone can trade, if true bypasses the traderAllowList. Can be called at anytime.
     *
     * @param matrixToken    Address of the MatrixToken
     * @param status         Boolean indicating if anyone can trade
     */
    function setAnyoneTrade(IMatrixToken matrixToken, bool status) external onlyManagerAndValidMatrix(matrixToken) {
        _permissionInfos[matrixToken].anyoneTrade = status;
        emit AnyoneTradeUpdated(matrixToken, status);
    }

    /**
     * @dev MANAGER ONLY: Called to initialize module to MatrixToken in order to allow GeneralIndexModule access for rebalances.
     * Grabs the current units for each asset in the Matrix and set's the targetUnit to that unit in order to prevent any
     * trading until startRebalance() is explicitly called. Position multiplier is also logged in order to make sure any
     * position multiplier changes don't unintentionally open the Matrix for rebalancing.
     *
     * @param matrixToken    Address of the MatrixToken
     */
    function initialize(IMatrixToken matrixToken) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        IMatrixToken.Position[] memory positions = matrixToken.getPositions();

        for (uint256 i = 0; i < positions.length; i++) {
            IMatrixToken.Position memory position = positions[i];
            require(position.positionState == 0, "G6");
            _executionInfos[matrixToken][IERC20(position.component)].targetUnit = position.unit.toUint256();
            _executionInfos[matrixToken][IERC20(position.component)].lastTradeTimestamp = 0;
        }

        _rebalanceInfos[matrixToken].positionMultiplier = matrixToken.getPositionMultiplier().toUint256();
        matrixToken.initializeModule();
    }

    /**
     * @dev Called by a MatrixToken to notify that this module was removed from the MatrixToken.
     * Clears the _rebalanceInfos and permissionsInfo of the calling MatrixToken.
     * IMPORTANT: MatrixToken's execution settings, including trade maximums and exchange names,
     * are NOT DELETED. Restoring a previously removed module requires that care is taken to
     * initialize execution settings appropriately.
     */
    function removeModule() external override {
        TradePermissionInfo storage tokenPermissionInfo = _permissionInfos[IMatrixToken(msg.sender)];

        for (uint256 i = 0; i < tokenPermissionInfo.tradersHistory.length; i++) {
            tokenPermissionInfo.tradeAllowList[tokenPermissionInfo.tradersHistory[i]] = false;
        }

        delete _rebalanceInfos[IMatrixToken(msg.sender)];
        delete _permissionInfos[IMatrixToken(msg.sender)];
    }

    // ==================== Internal functions ====================

    /**
     * A rebalance is a multi-step process in which current Matrix components are sold for a bridge asset (WETH)
     * before buying target components in the correct amount to achieve the desired balance between elements in the MatrixToken.
     *
     *        Step 1        |       Step 2
     * -------------------------------------------
     * Component --> WETH   |   WETH --> Component
     * -------------------------------------------
     *
     * The syntax we use frames this as trading from a "fixed" amount of one component to a "fixed" amount
     * of another via a "floating limit" which is *either* the maximum size of the trade we want to make
     * (trades may be tranched to avoid moving markets) OR the minimum amount of tokens we expect to receive.
     * The different meanings of the floating limit map to the trade sequence as below:
     *
     * Step 1: Component --> WETH
     * ----------------------------------------------------------
     *                     | Fixed  |     Floating limit        |
     * ----------------------------------------------------------
     * send  (Component)   |  YES   |                           |
     * recieve (WETH)      |        |   Min WETH to receive     |
     * ----------------------------------------------------------
     *
     * Step 2: WETH --> Component
     * ----------------------------------------------------------
     *                     |  Fixed  |    Floating limit        |
     * ----------------------------------------------------------
     * send  (WETH)        |   NO    |  Max WETH to send        |
     * recieve (Component) |   YES   |                          |
     * ----------------------------------------------------------
     *
     * Additionally, there is an edge case where price volatility during a rebalance
     * results in remaining WETH which needs to be allocated proportionately. In this case
     * the values are as below:
     *
     * Edge case: Remaining WETH --> Component
     * ----------------------------------------------------------
     *                     | Fixed  |    Floating limit         |
     * ----------------------------------------------------------
     * send  (WETH)        |  YES   |                           |
     * recieve (Component) |        | Min component to receive  |
     * ----------------------------------------------------------
     */

    /**
     * @dev Create and return TradeInfo struct. This function reverts if the target has already been met. If this is a
     * trade from component into WETH, sell the total fixed component quantity and expect to receive an ETH amount
     * the user has specified (or more). If it's a trade from WETH into a component, sell the lesser of:
     * the user's WETH limit OR the MatrixToken's remaining WETH balance and expect to receive a fixed component quantity.
     *
     * @param matrixToken         Instance of the MatrixToken to rebalance
     * @param component           IERC20 component to trade
     * @param ethQuantityLimit    Max/min amount of _weth spent/received during trade
     *
     * @return tradeInfo          Struct containing data for trade
     */
    function _createTradeInfo(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 ethQuantityLimit
    ) internal view virtual returns (TradeInfo memory tradeInfo) {
        tradeInfo = _getDefaultTradeInfo(matrixToken, component, true);

        if (tradeInfo.isSendTokenFixed) {
            tradeInfo.sendQuantity = tradeInfo.totalFixedQuantity;
            tradeInfo.floatingQuantityLimit = ethQuantityLimit;
        } else {
            tradeInfo.sendQuantity = ethQuantityLimit.min(tradeInfo.preTradeSendTokenBalance);
            tradeInfo.floatingQuantityLimit = tradeInfo.totalFixedQuantity;
        }
    }

    /**
     * @dev Create and return TradeInfo struct. This function does NOT check if the WETH target has been met.
     *
     * @param matrixToken             Instance of the MatrixToken to rebalance
     * @param component               IERC20 component to trade
     * @param minComponentReceived    Min amount of component received during trade
     *
     * @return tradeInfo              Struct containing data for tradeRemaining info
     */
    function _createTradeRemainingInfo(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 minComponentReceived
    ) internal view returns (TradeInfo memory tradeInfo) {
        tradeInfo = _getDefaultTradeInfo(matrixToken, component, false);
        (, , uint256 currentNotional, uint256 targetNotional) = _getUnitsAndNotionalAmounts(matrixToken, _weth, tradeInfo.matrixTotalSupply);
        tradeInfo.sendQuantity = currentNotional - targetNotional;
        tradeInfo.floatingQuantityLimit = minComponentReceived;
        tradeInfo.isSendTokenFixed = true;
    }

    /**
     * @dev Create and returns a partial TradeInfo struct with all fields that overlap between `trade` and
     * `tradeRemaining` info constructors filled in. Values for `sendQuantity` and `floatingQuantityLimit` are
     * derived separately, outside this method. `trade` requires that trade size and direction are calculated,
     * whereas `tradeRemaining` automatically sets WETH as the sendToken and component as receiveToken.
     *
     * @param matrixToken                Instance of the MatrixToken to rebalance
     * @param component                  IERC20 component to trade
     * @param calculateTradeDirection    Indicates whether method should calculate trade size and direction
     *
     * @return tradeInfo                 Struct containing partial data for trade
     */
    function _getDefaultTradeInfo(
        IMatrixToken matrixToken,
        IERC20 component,
        bool calculateTradeDirection
    ) internal view returns (TradeInfo memory tradeInfo) {
        tradeInfo.matrixToken = matrixToken;
        tradeInfo.matrixTotalSupply = matrixToken.totalSupply();
        tradeInfo.exchangeAdapter = _getExchangeAdapter(matrixToken, component);
        tradeInfo.exchangeData = _executionInfos[matrixToken][component].exchangeData;

        if (calculateTradeDirection) {
            (tradeInfo.isSendTokenFixed, tradeInfo.totalFixedQuantity) = _calculateTradeSizeAndDirection(matrixToken, component, tradeInfo.matrixTotalSupply);
        }

        if (tradeInfo.isSendTokenFixed) {
            tradeInfo.sendToken = address(component);
            tradeInfo.receiveToken = address(_weth);
        } else {
            tradeInfo.sendToken = address(_weth);
            tradeInfo.receiveToken = address(component);
        }

        tradeInfo.preTradeSendTokenBalance = IERC20(tradeInfo.sendToken).balanceOf(address(matrixToken));
        tradeInfo.preTradeReceiveTokenBalance = IERC20(tradeInfo.receiveToken).balanceOf(address(matrixToken));
    }

    /**
     * @dev Function handles all interactions with exchange. All GeneralIndexModule adapters must allow for selling or buying a fixed
     * quantity of a token in return for a non-fixed (floating) quantity of a token. If `isSendTokenFixed` is true then the adapter
     * will choose the exchange interface associated with inputting a fixed amount, otherwise it will select the interface used for
     * receiving a fixed amount. Any other exchange specific data can also be created by calling generateDataParam function.
     *
     * @param tradeInfo            Struct containing trade information used in internal functions
     */
    function _executeTrade(TradeInfo memory tradeInfo) internal virtual {
        tradeInfo.matrixToken.invokeSafeIncreaseAllowance(tradeInfo.sendToken, tradeInfo.exchangeAdapter.getSpender(), tradeInfo.sendQuantity);

        (address targetExchange, uint256 callValue, bytes memory methodData) = tradeInfo.exchangeAdapter.getTradeCalldata(
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            address(tradeInfo.matrixToken),
            tradeInfo.isSendTokenFixed,
            tradeInfo.sendQuantity,
            tradeInfo.floatingQuantityLimit,
            tradeInfo.exchangeData
        );

        tradeInfo.matrixToken.invoke(targetExchange, callValue, methodData);
    }

    /**
     * @dev Retrieve fee from controller and calculate total protocol fee and send from MatrixToken to protocol recipient.
     * The protocol fee is collected from the amount of received token in the trade.
     *
     * @param tradeInfo       Struct containing trade information used in internal functions
     *
     * @return protocolFee    Amount of receive token taken as protocol fee
     */
    function _accrueProtocolFee(TradeInfo memory tradeInfo) internal returns (uint256 protocolFee) {
        uint256 exchangedQuantity = IERC20(tradeInfo.receiveToken).balanceOf(address(tradeInfo.matrixToken)) - tradeInfo.preTradeReceiveTokenBalance;
        protocolFee = getModuleFee(GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX, exchangedQuantity);
        payProtocolFeeFromMatrixToken(tradeInfo.matrixToken, tradeInfo.receiveToken, protocolFee);
    }

    /**
     * @dev Update MatrixToken positions and _executionInfos's last trade timestamp. This function is intended
     * to be called after the fees have been accrued, hence it returns the amount of tokens bought net of fees.
     *
     * @param tradeInfo            Struct containing trade information used in internal functions
     * @param component            IERC20 component which was traded
     *
     * @return netSendAmount       Amount of sendTokens used in the trade
     * @return netReceiveAmount    Amount of receiveTokens received in the trade (net of fees)
     */
    function _updatePositionStateAndTimestamp(TradeInfo memory tradeInfo, IERC20 component) internal returns (uint256 netSendAmount, uint256 netReceiveAmount) {
        (uint256 postTradeSendTokenBalance, , ) = tradeInfo.matrixToken.calculateAndEditDefaultPosition(
            tradeInfo.sendToken,
            tradeInfo.matrixTotalSupply,
            tradeInfo.preTradeSendTokenBalance
        );
        (uint256 postTradeReceiveTokenBalance, , ) = tradeInfo.matrixToken.calculateAndEditDefaultPosition(
            tradeInfo.receiveToken,
            tradeInfo.matrixTotalSupply,
            tradeInfo.preTradeReceiveTokenBalance
        );

        netSendAmount = tradeInfo.preTradeSendTokenBalance - postTradeSendTokenBalance;
        netReceiveAmount = postTradeReceiveTokenBalance - tradeInfo.preTradeReceiveTokenBalance;
        _executionInfos[tradeInfo.matrixToken][component].lastTradeTimestamp = block.timestamp;
    }

    /**
     * @dev Adds or removes newly permissioned trader to/from permissionsInfo traderHistory. It's necessary to
     * verify that traderHistory contains the address because AddressArrayUtils will throw when attempting to
     * remove a non-element and it's possible someone can set a new trader's status to false.
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param trader         Trader whose permission is being set
     * @param status         Boolean permission being set

     */
    function _updateTradersHistory(
        IMatrixToken matrixToken,
        address trader,
        bool status
    ) internal {
        if (status && !_permissionInfos[matrixToken].tradersHistory.contain(trader)) {
            _permissionInfos[matrixToken].tradersHistory.push(trader);
        } else if (!status && _permissionInfos[matrixToken].tradersHistory.contain(trader)) {
            _permissionInfos[matrixToken].tradersHistory.quickRemoveItem(trader);
        }
    }

    /**
     * @dev Calculates the amount of a component is going to be traded and whether the component is being bought or sold.
     * If currentUnit and targetUnit are the same, function will revert.
     *
     * @param matrixToken                 Instance of the MatrixToken to rebalance
     * @param component                IERC20 component to trade
     * @param totalSupply              Total supply of matrixToken
     *
     * @return isSendTokenFixed         Boolean indicating fixed asset is send token
     * @return totalFixedQuantity       Amount of fixed token to send or receive
     */
    function _calculateTradeSizeAndDirection(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 totalSupply
    ) internal view returns (bool isSendTokenFixed, uint256 totalFixedQuantity) {
        uint256 protocolFee = _controller.getModuleFee(address(this), GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX);
        uint256 componentMaxSize = _executionInfos[matrixToken][component].maxSize;

        (uint256 currentUnit, uint256 targetUnit, uint256 currentNotional, uint256 targetNotional) = _getUnitsAndNotionalAmounts(
            matrixToken,
            component,
            totalSupply
        );

        require(currentUnit != targetUnit, "G7");

        isSendTokenFixed = targetNotional < currentNotional;

        // In order to account for fees taken by protocol when buying the notional difference between currentUnit
        // and targetUnit is divided by (1 - protocolFee) to make sure that targetUnit can be met. Failure to
        // do so would lead to never being able to meet target of components that need to be bought.
        //
        // ? - lesserOf: (componentMaxSize, (currentNotional - targetNotional))
        // : - lesserOf: (componentMaxSize, (targetNotional - currentNotional) / 10 ** 18 - protocolFee)
        totalFixedQuantity = isSendTokenFixed
            ? componentMaxSize.min(currentNotional - targetNotional)
            : componentMaxSize.min((targetNotional - currentNotional).preciseDiv(PreciseUnitMath.preciseUnit() - protocolFee));
    }

    /**
     * @dev Check if all targets are met.
     *
     * @param matrixToken    Instance of the MatrixToken to be rebalanced
     *
     * @return bool          True if all component's target units have been met, otherwise false
     */
    function _allTargetsMet(IMatrixToken matrixToken) internal view returns (bool) {
        address[] memory rebalanceComponents = _rebalanceInfos[matrixToken].rebalanceComponents;

        for (uint256 i = 0; i < rebalanceComponents.length; i++) {
            if (_targetUnmet(matrixToken, rebalanceComponents[i])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @dev Determine if passed address is allowed to call trade for the MatrixToken.
     * If anyoneTrade set to true anyone can call otherwise needs to be approved.
     *
     * @param matrixToken    Instance of MatrixToken to be rebalanced
     * @param  trader        Address of the trader who called contract function
     *
     * @return bool          True if trader is an approved trader for the MatrixToken
     */
    function _isAllowedTrader(IMatrixToken matrixToken, address trader) internal view returns (bool) {
        TradePermissionInfo storage permissions = _permissionInfos[matrixToken];

        return permissions.anyoneTrade || permissions.tradeAllowList[trader];
    }

    /**
     * @dev Checks if sell conditions are met. The component cannot be WETH and its normalized target
     * unit must be less than its default position real unit
     *
     * @param matrixToken    Instance of the MatrixToken to be rebalanced
     * @param component      Component evaluated for sale
     *
     * @return bool          True if sell allowed, false otherwise
     */
    function _canSell(IMatrixToken matrixToken, address component) internal view returns (bool) {
        return (component != address(_weth) &&
            (_getNormalizedTargetUnit(matrixToken, IERC20(component)) < _getDefaultPositionRealUnit(matrixToken, IERC20(component))));
    }

    /**
     * @dev Check if there are any more tokens to sell. Since we allow WETH to float around it's target during rebalances it is not checked.
     *
     * @param matrixToken    Instance of the MatrixToken to be rebalanced
     *
     * @return bool          True if there is not any component that can be sold, otherwise false
     */
    function _noTokensToSell(IMatrixToken matrixToken) internal view returns (bool) {
        address[] memory rebalanceComponents = _rebalanceInfos[matrixToken].rebalanceComponents;

        for (uint256 i = 0; i < rebalanceComponents.length; i++) {
            if (_canSell(matrixToken, rebalanceComponents[i])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @dev Determines if a target is met. Due to small rounding errors converting between virtual and real unit on
     * MatrixToken we allow for a 1 wei buffer when checking if target is met. In order to avoid subtraction overflow
     * errors targetUnits of zero check for an exact amount. WETH is not checked as it is allowed to float around its target.
     *
     * @param matrixToken    Instance of the MatrixToken to be rebalanced
     * @param component      Component whose target is evaluated
     *
     * @return bool          True if component's target units are met, false otherwise
     */
    function _targetUnmet(IMatrixToken matrixToken, address component) internal view returns (bool) {
        if (component == address(_weth)) return false;

        uint256 normalizedTargetUnit = _getNormalizedTargetUnit(matrixToken, IERC20(component));
        uint256 currentUnit = _getDefaultPositionRealUnit(matrixToken, IERC20(component));

        return (normalizedTargetUnit > 0) ? !(normalizedTargetUnit.approximatelyEquals(currentUnit, 1)) : normalizedTargetUnit != currentUnit;
    }

    /**
     * @dev Validate component position unit has not exceeded it's target unit. This is used during tradeRemainingWETH() to make sure
     * the amount of component bought does not exceed the targetUnit.
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param component      IERC20 component whose position units are to be validated
     */
    function _validateComponentPositionUnit(IMatrixToken matrixToken, IERC20 component) internal view {
        uint256 currentUnit = _getDefaultPositionRealUnit(matrixToken, component);
        uint256 targetUnit = _getNormalizedTargetUnit(matrixToken, component);
        require(currentUnit <= targetUnit, "G8");
    }

    /**
     * @dev Validate that component is a valid component and enough time has elapsed since component's last trade. Traders
     * cannot explicitly trade WETH, it may only implicitly be traded by being the quote asset for other component trades.
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param component      IERC20 component to be validated
     */
    function _validateTradeParameters(IMatrixToken matrixToken, IERC20 component) internal view virtual {
        require(address(component) != address(_weth), "G9a");
        require(_rebalanceInfos[matrixToken].rebalanceComponents.contain(address(component)), "G9b");

        TradeExecutionParams memory componentInfo = _executionInfos[matrixToken][component];

        require(componentInfo.lastTradeTimestamp + componentInfo.coolOffPeriod <= block.timestamp, "G9c");
        require(!matrixToken.hasExternalPosition(address(component)), "G9d");
    }

    /**
     * @dev Extends and/or updates the current component set and its target units with new components and targets,
     * Validates inputs, requiring that that new components and new target units arrays are the same size, and
     * that the number of old components target units matches the number of current components. Throws if
     * a duplicate component has been added.
     *
     * @param currentComponents           Complete set of current MatrixToken components
     * @param newComponents               Array of new components to add to allocation
     * @param newComponentsTargetUnits    Array of target units at end of rebalance for new components, maps to same index of newComponents array
     * @param oldComponentsTargetUnits    Array of target units at end of rebalance for old component, maps to same index of
     *                                               matrixToken.getComponents() array, if component being removed set to 0.
     *
     * @return aggregateComponents        Array of current components extended by new components, without duplicates
     * @return aggregateTargetUnits       Array of old component target units extended by new target units, without duplicates
     */
    function _getAggregateComponentsAndUnits(
        address[] memory currentComponents,
        address[] calldata newComponents,
        uint256[] calldata newComponentsTargetUnits,
        uint256[] calldata oldComponentsTargetUnits
    ) internal pure returns (address[] memory aggregateComponents, uint256[] memory aggregateTargetUnits) {
        // Don't use validate arrays because empty arrays are valid
        require(newComponents.length == newComponentsTargetUnits.length, "G10a");
        require(currentComponents.length == oldComponentsTargetUnits.length, "G10b");

        aggregateComponents = currentComponents.merge(newComponents);
        aggregateTargetUnits = oldComponentsTargetUnits.merge(newComponentsTargetUnits);

        require(!aggregateComponents.hasDuplicate(), "G10c");
    }

    /**
     * @dev Get the MatrixToken's default position as uint256
     *
     * @param matrixToken    Instance of the MatrixToken
     * @param component      IERC20 component to fetch the default position for
     *
     * @return uint256       Real unit position
     */
    function _getDefaultPositionRealUnit(IMatrixToken matrixToken, IERC20 component) internal view returns (uint256) {
        return matrixToken.getDefaultPositionRealUnit(address(component)).toUint256();
    }

    /**
     * @dev Gets exchange adapter address for a component after checking that it exists in the
     * IntegrationRegistry. This method is called during a trade and must validate the adapter
     * because its state may have changed since it was set in a separate transaction.
     *
     * @param matrixToken          Instance of the MatrixToken to be rebalanced
     * @param component            IERC20 component whose exchange adapter is fetched
     *
     * @return IExchangeAdapter    Adapter address
     */
    function _getExchangeAdapter(IMatrixToken matrixToken, IERC20 component) internal view returns (IIndexExchangeAdapter) {
        return IIndexExchangeAdapter(getAndValidateAdapter(_executionInfos[matrixToken][component].exchangeName));
    }

    /**
     * @dev Calculates and returns the normalized target unit value.
     *
     * @param matrixToken    Instance of the MatrixToken to be rebalanced
     * @param component      IERC20 component whose normalized target unit is required
     *
     * @return uint256       Normalized target unit of the component
     */
    function _getNormalizedTargetUnit(IMatrixToken matrixToken, IERC20 component) internal view returns (uint256) {
        // (targetUnit * current position multiplier) / position multiplier when rebalance started
        return
            (_executionInfos[matrixToken][component].targetUnit * matrixToken.getPositionMultiplier().toUint256()) /
            _rebalanceInfos[matrixToken].positionMultiplier;
    }

    /**
     * @dev Gets unit and notional amount values for current position and target. These are necessary to calculate
     * the trade size and direction for regular trades and the `sendQuantity` for remainingWEth trades.
     *
     * @param matrixToken    Instance of the MatrixToken to rebalance
     * @param component      IERC20 component to calculate notional amounts for
     * @param totalSupply    MatrixToken total supply
     *
     * @return uint256       Current default position real unit of component
     * @return uint256       Normalized unit of the trade target
     * @return uint256       Current notional amount: total notional amount of MatrixToken default position
     * @return uint256       Target notional amount: Total MatrixToken supply * targetUnit
     */
    function _getUnitsAndNotionalAmounts(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 totalSupply
    )
        internal
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        uint256 currentUnit = _getDefaultPositionRealUnit(matrixToken, component);
        uint256 targetUnit = _getNormalizedTargetUnit(matrixToken, component);
        uint256 currentNotional = PositionUtil.getDefaultTotalNotional(totalSupply, currentUnit);

        return (currentUnit, targetUnit, currentNotional, totalSupply.preciseMulCeil(targetUnit));
    }

    // ==================== Private functions ====================

    function _validateOnlyAllowedTrader(IMatrixToken matrixToken) private view {
        require(_isAllowedTrader(matrixToken, msg.sender), "G11");
    }

    /*
     * @dev Trade must be an EOA if anyoneTrade has been enabled for MatrixToken on the module.
     */
    function _validateOnlyEOAIfUnrestricted(IMatrixToken matrixToken) private view {
        require(!_permissionInfos[matrixToken].anyoneTrade || (msg.sender == tx.origin), "G12");
    }
}
