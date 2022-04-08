// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IAmmAdapter } from "../../interfaces/IAmmAdapter.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title AmmModule
 *
 * @dev A smart contract module that enables joining and exiting of AMM Pools using multiple or a single ERC20s.
 * Examples of intended protocols include Curve, Uniswap, and Balancer.
 */
contract AmmModule is ModuleBase, ReentrancyGuard {
    using SafeCast for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== Structs ====================

    struct ActionInfo {
        uint256 totalSupply; // Total supply of the MatrixToken
        uint256 preActionLiquidityTokenBalance; // Balance of liquidity token before add/remove liquidity action
        uint256 liquidityQuantity; // When adding liquidity, minimum quantity of liquidity required; When removing liquidity, quantity to dispose of
        address liquidityToken; // Address of the AMM pool token
        IMatrixToken matrixToken; // Instance of MatrixToken
        IAmmAdapter ammAdapter; // Instance of amm adapter contract
        uint256[] preActionComponentBalances; // Balance of components before add/remove liquidity action
        uint256[] totalNotionalComponents; // When adding liquidity, maximum components provided; When removing liquidity, minimum components to receive
        uint256[] componentUnits; // List of inputted component real units
        address[] components; // List of component addresses for providing/removing liquidity
    }

    // ==================== Events ====================

    event AddLiquidity(
        IMatrixToken indexed matrixToken,
        address indexed ammPool,
        int256 ammPoolBalancesDelta, // Change in MatrixToken AMM Liquidity Pool token balances
        address[] components,
        int256[] componentBalancesDelta // Change in MatrixToken component token balances
    );

    event RemoveLiquidity(
        IMatrixToken indexed matrixToken,
        address indexed ammPool,
        int256 ammPoolBalancesDelta, // Change in AMM pool token balances
        address[] components,
        int256[] componentBalancesDelta // Change in MatrixToken component token balances
    );

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== External functions ====================

    /**
     * @dev MANAGER ONLY. Adds liquidity to an AMM pool for a specified AMM. User specifies what components and quantity of
     * components to contribute and the minimum number of liquidity pool tokens to receive.
     *
     * @param matrixToken                 Address of MatrixToken
     * @param ammName                     Human readable name of integration (e.g. CURVE) stored in the IntegrationRegistry
     * @param ammPool                     Address of the AMM pool; Must be valid according to the Amm Adapter
     * @param minPoolTokenPositionUnit    Minimum number of liquidity pool tokens to receive in position units
     * @param components                  List of components to contribute as liquidity to the Amm pool
     * @param maxComponentUnits           Quantities of components in position units to contribute
     */
    function addLiquidity(
        IMatrixToken matrixToken,
        string memory ammName,
        address ammPool,
        uint256 minPoolTokenPositionUnit,
        address[] calldata components,
        uint256[] calldata maxComponentUnits
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory actionInfo = _getActionInfo(matrixToken, ammName, ammPool, components, maxComponentUnits, minPoolTokenPositionUnit);
        _validateAddLiquidity(actionInfo);
        _executeAddLiquidity(actionInfo);
        _validateMinimumLiquidityReceived(actionInfo);

        int256[] memory componentsDelta = _updateComponentPositions(actionInfo);
        int256 liquidityTokenDelta = _updateLiquidityTokenPositions(actionInfo);

        emit AddLiquidity(matrixToken, ammPool, liquidityTokenDelta, components, componentsDelta);
    }

    /**
     * @dev MANAGER ONLY. Adds liquidity to an AMM pool for a specified AMM using a single asset if supported.
     * Differs from addLiquidity as it will opt to use the AMMs single asset liquidity function if it exists
     * User specifies what component and component quantity to contribute and the minimum number of
     * liquidity pool tokens to receive.
     *
     * @param matrixToken                 Address of MatrixToken
     * @param ammName                     Human readable name of integration (e.g. CURVE) stored in the IntegrationRegistry
     * @param ammPool                     Address of the AMM pool; Must be valid according to the Amm Adapter
     * @param minPoolTokenPositionUnit    Minimum number of liquidity pool tokens to receive in position units
     * @param component                   Component to contribute as liquidity to the Amm pool
     * @param maxComponentUnit            Quantity of component in position units to contribute
     */
    function addLiquiditySingleAsset(
        IMatrixToken matrixToken,
        string memory ammName,
        address ammPool,
        uint256 minPoolTokenPositionUnit,
        address component,
        uint256 maxComponentUnit
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory actionInfo = _getActionInfoSingleAsset(matrixToken, ammName, ammPool, component, maxComponentUnit, minPoolTokenPositionUnit);
        _validateAddLiquidity(actionInfo);
        _executeAddLiquiditySingleAsset(actionInfo);
        _validateMinimumLiquidityReceived(actionInfo);

        int256[] memory componentsDelta = _updateComponentPositions(actionInfo);
        int256 liquidityTokenDelta = _updateLiquidityTokenPositions(actionInfo);

        emit AddLiquidity(matrixToken, ammPool, liquidityTokenDelta, actionInfo.components, componentsDelta);
    }

    /**
     * @dev MANAGER ONLY. Removes liquidity from an AMM pool for a specified AMM. User specifies the exact number of
     * liquidity pool tokens to provide and the components and minimum quantity of component units to receive
     *
     * @param matrixToken                  Address of MatrixToken
     * @param ammName                      Human readable name of integration (e.g. CURVE) stored in the IntegrationRegistry
     * @param ammPool                      Address of the AMM pool; Must be valid according to the Amm Adapter
     * @param poolTokenPositionUnits       Number of liquidity pool tokens to burn
     * @param components                   Component to receive from the AMM Pool
     * @param minComponentUnitsReceived    Minimum quantity of components in position units to receive
     */
    function removeLiquidity(
        IMatrixToken matrixToken,
        string memory ammName,
        address ammPool,
        uint256 poolTokenPositionUnits,
        address[] calldata components,
        uint256[] calldata minComponentUnitsReceived
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory actionInfo = _getActionInfo(matrixToken, ammName, ammPool, components, minComponentUnitsReceived, poolTokenPositionUnits);
        _validateRemoveLiquidity(actionInfo);
        _executeRemoveLiquidity(actionInfo);
        _validateMinimumUnderlyingReceived(actionInfo);

        int256 liquidityTokenDelta = _updateLiquidityTokenPositions(actionInfo);
        int256[] memory componentsDelta = _updateComponentPositions(actionInfo);

        emit RemoveLiquidity(matrixToken, ammPool, liquidityTokenDelta, components, componentsDelta);
    }

    /**
     * @dev MANAGER ONLY. Removes liquidity from an AMM pool for a specified AMM, receiving a single component.
     * User specifies the exact number of liquidity pool tokens to provide, the components, and minimum quantity of component
     * units to receive
     *
     * @param matrixToken                  Address of MatrixToken
     * @param ammName                      Human readable name of integration (e.g. CURVE) stored in the IntegrationRegistry
     * @param ammPool                      Address of the AMM pool; Must be valid according to the Amm Adapter
     * @param poolTokenPositionUnits       Number of liquidity pool tokens to burn
     * @param component                    Component to receive from the AMM Pool
     * @param minComponentUnitsReceived    Minimum quantity of component in position units to receive
     */
    function removeLiquiditySingleAsset(
        IMatrixToken matrixToken,
        string memory ammName,
        address ammPool,
        uint256 poolTokenPositionUnits,
        address component,
        uint256 minComponentUnitsReceived
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        ActionInfo memory actionInfo = _getActionInfoSingleAsset(matrixToken, ammName, ammPool, component, minComponentUnitsReceived, poolTokenPositionUnits);

        _validateRemoveLiquidity(actionInfo);
        _executeRemoveLiquiditySingleAsset(actionInfo);
        _validateMinimumUnderlyingReceived(actionInfo);

        int256 liquidityTokenDelta = _updateLiquidityTokenPositions(actionInfo);
        int256[] memory componentsDelta = _updateComponentPositions(actionInfo);

        emit RemoveLiquidity(matrixToken, ammPool, liquidityTokenDelta, actionInfo.components, componentsDelta);
    }

    /**
     * @dev Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     */
    function initialize(IMatrixToken matrixToken) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     */
    function removeModule() external override {}

    // ==================== Internal functions ====================

    function _getActionInfo(
        IMatrixToken matrixToken,
        string memory integrationName,
        address ammPool,
        address[] memory components,
        uint256[] memory componentUnits,
        uint256 poolTokenInPositionUnit
    ) internal view returns (ActionInfo memory) {
        ActionInfo memory actionInfo;
        actionInfo.matrixToken = matrixToken;
        actionInfo.totalSupply = matrixToken.totalSupply();
        actionInfo.ammAdapter = IAmmAdapter(getAndValidateAdapter(integrationName));
        actionInfo.liquidityToken = ammPool;
        actionInfo.preActionLiquidityTokenBalance = IERC20(ammPool).balanceOf(address(matrixToken));
        actionInfo.preActionComponentBalances = _getTokenBalances(address(matrixToken), components);
        actionInfo.liquidityQuantity = PositionUtil.getDefaultTotalNotional(actionInfo.totalSupply, poolTokenInPositionUnit);
        actionInfo.totalNotionalComponents = _getTotalNotionalComponents(matrixToken, componentUnits);
        actionInfo.componentUnits = componentUnits;
        actionInfo.components = components;

        return actionInfo;
    }

    function _getActionInfoSingleAsset(
        IMatrixToken matrixToken,
        string memory integrationName,
        address ammPool,
        address component,
        uint256 maxPositionUnitToPool,
        uint256 minPoolToken
    ) internal view returns (ActionInfo memory) {
        address[] memory components = new address[](1);
        uint256[] memory maxPositionUnitsToPool = new uint256[](1);

        components[0] = component;
        maxPositionUnitsToPool[0] = maxPositionUnitToPool;

        return _getActionInfo(matrixToken, integrationName, ammPool, components, maxPositionUnitsToPool, minPoolToken);
    }

    function _validateAddLiquidity(ActionInfo memory actionInfo) internal view {
        _validateCommon(actionInfo);

        for (uint256 i = 0; i < actionInfo.components.length; i++) {
            address component = actionInfo.components[i];

            require(actionInfo.matrixToken.hasSufficientDefaultUnits(component, actionInfo.componentUnits[i]), "AM0");
        }
    }

    function _validateRemoveLiquidity(ActionInfo memory actionInfo) internal view {
        _validateCommon(actionInfo);

        for (uint256 i = 0; i < actionInfo.components.length; i++) {
            require(actionInfo.componentUnits[i] > 0, "AM1a");
        }

        require(actionInfo.matrixToken.hasSufficientDefaultUnits(actionInfo.liquidityToken, actionInfo.liquidityQuantity), "AM1b");
    }

    function _validateCommon(ActionInfo memory actionInfo) internal view {
        require(actionInfo.componentUnits.length == actionInfo.components.length, "AM2a");
        require(actionInfo.liquidityQuantity > 0, "AM2b");
        require(actionInfo.ammAdapter.isValidPool(actionInfo.liquidityToken, actionInfo.components), "AM2c");
    }

    function _executeComponentApprovals(ActionInfo memory actionInfo) internal {
        address spender = actionInfo.ammAdapter.getSpenderAddress(actionInfo.liquidityToken);

        // Loop through and approve total notional tokens to spender
        for (uint256 i = 0; i < actionInfo.components.length; i++) {
            actionInfo.matrixToken.invokeSafeIncreaseAllowance(actionInfo.components[i], spender, actionInfo.totalNotionalComponents[i]);
        }
    }

    function _executeAddLiquidity(ActionInfo memory actionInfo) internal {
        (address targetAmm, uint256 callValue, bytes memory methodData) = actionInfo.ammAdapter.getProvideLiquidityCalldata(
            address(actionInfo.matrixToken),
            actionInfo.liquidityToken,
            actionInfo.components,
            actionInfo.totalNotionalComponents,
            actionInfo.liquidityQuantity
        );

        _executeComponentApprovals(actionInfo);
        actionInfo.matrixToken.invoke(targetAmm, callValue, methodData);
    }

    function _executeAddLiquiditySingleAsset(ActionInfo memory actionInfo) internal {
        (address targetAmm, uint256 callValue, bytes memory methodData) = actionInfo.ammAdapter.getProvideLiquiditySingleAssetCalldata(
            address(actionInfo.matrixToken),
            actionInfo.liquidityToken,
            actionInfo.components[0],
            actionInfo.totalNotionalComponents[0],
            actionInfo.liquidityQuantity
        );

        _executeComponentApprovals(actionInfo);
        actionInfo.matrixToken.invoke(targetAmm, callValue, methodData);
    }

    function _executeRemoveLiquidity(ActionInfo memory actionInfo) internal {
        (address targetAmm, uint256 callValue, bytes memory methodData) = actionInfo.ammAdapter.getRemoveLiquidityCalldata(
            address(actionInfo.matrixToken),
            actionInfo.liquidityToken,
            actionInfo.components,
            actionInfo.totalNotionalComponents,
            actionInfo.liquidityQuantity
        );

        actionInfo.matrixToken.invokeSafeIncreaseAllowance(
            actionInfo.liquidityToken,
            actionInfo.ammAdapter.getSpenderAddress(actionInfo.liquidityToken),
            actionInfo.liquidityQuantity
        );

        actionInfo.matrixToken.invoke(targetAmm, callValue, methodData);
    }

    function _executeRemoveLiquiditySingleAsset(ActionInfo memory actionInfo) internal {
        (address targetAmm, uint256 callValue, bytes memory methodData) = actionInfo.ammAdapter.getRemoveLiquiditySingleAssetCalldata(
            address(actionInfo.matrixToken),
            actionInfo.liquidityToken,
            actionInfo.components[0],
            actionInfo.totalNotionalComponents[0],
            actionInfo.liquidityQuantity
        );

        actionInfo.matrixToken.invokeSafeIncreaseAllowance(
            actionInfo.liquidityToken,
            actionInfo.ammAdapter.getSpenderAddress(actionInfo.liquidityToken),
            actionInfo.liquidityQuantity
        );

        actionInfo.matrixToken.invoke(targetAmm, callValue, methodData);
    }

    function _validateMinimumLiquidityReceived(ActionInfo memory actionInfo) internal view {
        uint256 liquidityTokenBalance = IERC20(actionInfo.liquidityToken).balanceOf(address(actionInfo.matrixToken));

        require(liquidityTokenBalance >= actionInfo.liquidityQuantity + actionInfo.preActionLiquidityTokenBalance, "AM3");
    }

    function _validateMinimumUnderlyingReceived(ActionInfo memory actionInfo) internal view {
        for (uint256 i = 0; i < actionInfo.components.length; i++) {
            uint256 underlyingBalance = IERC20(actionInfo.components[i]).balanceOf(address(actionInfo.matrixToken));

            require(underlyingBalance >= actionInfo.totalNotionalComponents[i] + actionInfo.preActionComponentBalances[i], "AM4");
        }
    }

    function _updateComponentPositions(ActionInfo memory actionInfo) internal returns (int256[] memory) {
        int256[] memory componentsReceived = new int256[](actionInfo.components.length);

        for (uint256 i = 0; i < actionInfo.components.length; i++) {
            (uint256 currentComponentBalance, , ) = actionInfo.matrixToken.calculateAndEditDefaultPosition(
                actionInfo.components[i],
                actionInfo.totalSupply,
                actionInfo.preActionComponentBalances[i]
            );

            componentsReceived[i] = currentComponentBalance.toInt256() - actionInfo.preActionComponentBalances[i].toInt256();
        }

        return componentsReceived;
    }

    function _updateLiquidityTokenPositions(ActionInfo memory actionInfo) internal returns (int256) {
        (uint256 currentLiquidityTokenBalance, , ) = actionInfo.matrixToken.calculateAndEditDefaultPosition(
            actionInfo.liquidityToken,
            actionInfo.totalSupply,
            actionInfo.preActionLiquidityTokenBalance
        );

        return currentLiquidityTokenBalance.toInt256() - actionInfo.preActionLiquidityTokenBalance.toInt256();
    }

    function _getTokenBalances(address owner, address[] memory tokens) internal view returns (uint256[] memory) {
        uint256[] memory tokenBalances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBalances[i] = IERC20(tokens[i]).balanceOf(owner);
        }

        return tokenBalances;
    }

    function _getTotalNotionalComponents(IMatrixToken matrixToken, uint256[] memory tokenAmounts) internal view returns (uint256[] memory) {
        uint256 totalSupply = matrixToken.totalSupply();
        uint256[] memory totalNotionalQuantities = new uint256[](tokenAmounts.length);

        for (uint256 i = 0; i < tokenAmounts.length; i++) {
            totalNotionalQuantities[i] = PositionUtil.getDefaultTotalNotional(totalSupply, tokenAmounts[i]);
        }

        return totalNotionalQuantities;
    }
}
