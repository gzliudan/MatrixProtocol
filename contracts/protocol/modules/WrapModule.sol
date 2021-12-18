// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IController } from "../../interfaces/IController.sol";
import { IWrapAdapter } from "../../interfaces/IWrapAdapter.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title WrapModule
 *
 * @dev Enables the wrapping of ERC20 and Ether positions via third party protocols. The WrapModule works in
 * conjunction with WrapAdapters, in which the wrapAdapterID / integrationNames are stored on the integration registry.
 * Some examples of wrap actions include wrapping, DAI to cDAI (Compound) or Dai to aDai (AAVE).
 */
contract WrapModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using PositionUtil for IMatrixToken;

    // ==================== Variables ====================

    IWETH public _weth;

    // ==================== Events ====================

    event WrapComponent(
        IMatrixToken indexed matrixToken,
        address indexed underlyingToken,
        address indexed wrappedToken,
        uint256 underlyingQuantity,
        uint256 wrappedQuantity,
        string integrationName
    );

    event UnwrapComponent(
        IMatrixToken indexed matrixToken,
        address indexed underlyingToken,
        address indexed wrappedToken,
        uint256 underlyingQuantity,
        uint256 wrappedQuantity,
        string integrationName
    );

    // ==================== Constructor function ====================

    constructor(IController controller, IWETH weth) ModuleBase(controller) {
        _weth = weth;
    }

    // ==================== External functions ====================

    /**
     * @dev MANAGER-ONLY: Instructs the MatrixToken to wrap an underlying asset into a wrappedToken via a specified adapter.
     *
     * @param matrixToken         Instance of the MatrixToken
     * @param underlyingToken     Address of the component to be wrapped
     * @param wrappedToken        Address of the desired wrapped token
     * @param underlyingUnits     Quantity of underlying units in Position units
     * @param integrationName     Name of wrap module integration (mapping on integration registry)
     */
    function wrap(
        IMatrixToken matrixToken,
        address underlyingToken,
        address wrappedToken,
        uint256 underlyingUnits,
        string calldata integrationName
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        (uint256 notionalUnderlyingWrapped, uint256 notionalWrapped) = _validateWrapAndUpdate(
            integrationName,
            matrixToken,
            underlyingToken,
            wrappedToken,
            underlyingUnits,
            false // does not use Ether
        );

        emit WrapComponent(matrixToken, underlyingToken, wrappedToken, notionalUnderlyingWrapped, notionalWrapped, integrationName);
    }

    /**
     * @dev MANAGER-ONLY: Instructs the MatrixToken to wrap Ether into a wrappedToken via a specified adapter. Since MatrixTokens
     * only hold WETH, in order to support protocols that collateralize with Ether the MatrixToken's WETH must be unwrapped
     * first before sending to the external protocol.
     *
     * @param matrixToken        Instance of the MatrixToken
     * @param wrappedToken       Address of the desired wrapped token
     * @param underlyingUnits    Quantity of underlying units in Position units
     * @param integrationName    Name of wrap module integration (mapping on integration registry)
     */
    function wrapWithEther(
        IMatrixToken matrixToken,
        address wrappedToken,
        uint256 underlyingUnits,
        string calldata integrationName
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        (uint256 notionalUnderlyingWrapped, uint256 notionalWrapped) = _validateWrapAndUpdate(
            integrationName,
            matrixToken,
            address(_weth),
            wrappedToken,
            underlyingUnits,
            true // uses Ether
        );

        emit WrapComponent(matrixToken, address(_weth), wrappedToken, notionalUnderlyingWrapped, notionalWrapped, integrationName);
    }

    /**
     * @dev MANAGER-ONLY: Instructs the MatrixToken to unwrap a wrapped asset into its underlying via a specified adapter.
     *
     * @param matrixToken        Instance of the MatrixToken
     * @param underlyingToken    Address of the underlying asset
     * @param wrappedToken       Address of the component to be unwrapped
     * @param wrappedUnits       Quantity of wrapped tokens in Position units
     * @param integrationName    ID of wrap module integration (mapping on integration registry)
     */
    function unwrap(
        IMatrixToken matrixToken,
        address underlyingToken,
        address wrappedToken,
        uint256 wrappedUnits,
        string calldata integrationName
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        (uint256 notionalUnderlyingUnwrapped, uint256 notionalUnwrapped) = _validateUnwrapAndUpdate(
            integrationName,
            matrixToken,
            underlyingToken,
            wrappedToken,
            wrappedUnits,
            false // uses Ether
        );

        emit UnwrapComponent(matrixToken, underlyingToken, wrappedToken, notionalUnderlyingUnwrapped, notionalUnwrapped, integrationName);
    }

    /**
     * @dev MANAGER-ONLY: Instructs the MatrixToken to unwrap a wrapped asset collateralized by Ether into Wrapped Ether. Since
     * external protocol will send back Ether that Ether must be Wrapped into WETH in order to be accounted for by MatrixToken.
     *
     * @param matrixToken        Instance of the MatrixToken
     * @param wrappedToken       Address of the component to be unwrapped
     * @param wrappedUnits       Quantity of wrapped tokens in Position units
     * @param integrationName    ID of wrap module integration (mapping on integration registry)
     */
    function unwrapWithEther(
        IMatrixToken matrixToken,
        address wrappedToken,
        uint256 wrappedUnits,
        string calldata integrationName
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        (uint256 notionalUnderlyingUnwrapped, uint256 notionalUnwrapped) = _validateUnwrapAndUpdate(
            integrationName,
            matrixToken,
            address(_weth),
            wrappedToken,
            wrappedUnits,
            true // uses Ether
        );

        emit UnwrapComponent(matrixToken, address(_weth), wrappedToken, notionalUnderlyingUnwrapped, notionalUnwrapped, integrationName);
    }

    /**
     * @dev Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     */
    function initialize(IMatrixToken matrixToken) external onlyMatrixManager(matrixToken, msg.sender) {
        require(_controller.isMatrix(address(matrixToken)), "WM0a");
        require(isMatrixPendingInitialization(matrixToken), "WM0b");
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     */
    function removeModule() external override {}

    // ==================== Internal functions ====================

    /**
     * @dev Validates the wrap operation is valid. In particular, the following checks are made:
     * - The position is Default
     * - The position has sufficient units given the transact quantity
     * - The transact quantity > 0
     *
     * It is expected that the adapter will check if wrappedToken/underlyingToken are a valid pair for the given
     * integration.
     */
    function _validateInputs(
        IMatrixToken matrixToken,
        address transactPosition,
        uint256 transactPositionUnits
    ) internal view {
        require(transactPositionUnits > 0, "WM1a");
        require(matrixToken.hasDefaultPosition(transactPosition), "WM1b");
        require(matrixToken.hasSufficientDefaultUnits(transactPosition, transactPositionUnits), "WM1c");
    }

    /**
     * @dev The WrapModule calculates the total notional underlying to wrap, approves the underlying to the 3rd party
     * integration contract, then invokes the MatrixToken to call wrap by passing its calldata along. When raw ETH
     * is being used (usesEther = true) WETH position must first be unwrapped and underlyingAddress sent to
     * adapter must be external protocol's ETH representative address.
     *
     * Returns notional amount of underlying tokens and wrapped tokens that were wrapped.
     */
    function _validateWrapAndUpdate(
        string calldata integrationName,
        IMatrixToken matrixToken,
        address underlyingToken,
        address wrappedToken,
        uint256 underlyingUnits,
        bool usesEther
    ) internal returns (uint256, uint256) {
        _validateInputs(matrixToken, underlyingToken, underlyingUnits);

        // Snapshot pre wrap balances
        (uint256 preActionUnderlyingNotional, uint256 preActionWrapNotional) = _snapshotTargetAssetsBalance(matrixToken, underlyingToken, wrappedToken);
        uint256 notionalUnderlying = PositionUtil.getDefaultTotalNotional(matrixToken.totalSupply(), underlyingUnits);
        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(integrationName));

        // Execute any pre-wrap actions depending on if using raw ETH or not
        if (usesEther) {
            matrixToken.invokeUnwrapWETH(address(_weth), notionalUnderlying);
        } else {
            address spender = wrapAdapter.getSpenderAddress(underlyingToken, wrappedToken);
            matrixToken.invokeSafeIncreaseAllowance(underlyingToken, spender, notionalUnderlying);
        }

        // Get function call data and invoke on MatrixToken
        _createWrapDataAndInvoke(matrixToken, wrapAdapter, usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : underlyingToken, wrappedToken, notionalUnderlying);

        // Snapshot post wrap balances
        (uint256 postActionUnderlyingNotional, uint256 postActionWrapNotional) = _snapshotTargetAssetsBalance(matrixToken, underlyingToken, wrappedToken);

        _updatePosition(matrixToken, underlyingToken, preActionUnderlyingNotional, postActionUnderlyingNotional);
        _updatePosition(matrixToken, wrappedToken, preActionWrapNotional, postActionWrapNotional);

        return (preActionUnderlyingNotional - postActionUnderlyingNotional, postActionWrapNotional - preActionWrapNotional);
    }

    /**
     * @dev The WrapModule calculates the total notional wrap token to unwrap, then invokes the MatrixToken to call
     * unwrap by passing its calldata along. When raw ETH is being used (usesEther = true) underlyingAddress
     * sent to adapter must be set to external protocol's ETH representative address and ETH returned from
     * external protocol is wrapped.
     *
     * Returns notional amount of underlying tokens and wrapped tokens unwrapped.
     */
    function _validateUnwrapAndUpdate(
        string calldata integrationName,
        IMatrixToken matrixToken,
        address underlyingToken,
        address wrappedToken,
        uint256 wrappedTokenUnits,
        bool usesEther
    ) internal returns (uint256, uint256) {
        _validateInputs(matrixToken, wrappedToken, wrappedTokenUnits);
        (uint256 preActionUnderlyingNotional, uint256 preActionWrapNotional) = _snapshotTargetAssetsBalance(matrixToken, underlyingToken, wrappedToken);
        uint256 notionalWrappedToken = PositionUtil.getDefaultTotalNotional(matrixToken.totalSupply(), wrappedTokenUnits);
        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(integrationName));

        // Get function call data and invoke on MatrixToken
        _createUnwrapDataAndInvoke(matrixToken, wrapAdapter, usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : underlyingToken, wrappedToken, notionalWrappedToken);

        if (usesEther) {
            matrixToken.invokeWrapWETH(address(_weth), address(matrixToken).balance);
        }

        (uint256 postActionUnderlyingNotional, uint256 postActionWrapNotional) = _snapshotTargetAssetsBalance(matrixToken, underlyingToken, wrappedToken);
        _updatePosition(matrixToken, underlyingToken, preActionUnderlyingNotional, postActionUnderlyingNotional);
        _updatePosition(matrixToken, wrappedToken, preActionWrapNotional, postActionWrapNotional);

        return (postActionUnderlyingNotional - preActionUnderlyingNotional, preActionWrapNotional - postActionWrapNotional);
    }

    /**
     * @dev Create the calldata for wrap and then invoke the call on the MatrixToken.
     */
    function _createWrapDataAndInvoke(
        IMatrixToken matrixToken,
        IWrapAdapter wrapAdapter,
        address underlyingToken,
        address wrappedToken,
        uint256 notionalUnderlying
    ) internal {
        (address callTarget, uint256 callValue, bytes memory callByteData) = wrapAdapter.getWrapCallData(underlyingToken, wrappedToken, notionalUnderlying);
        matrixToken.invoke(callTarget, callValue, callByteData);
    }

    /**
     * @dev Create the calldata for unwrap and then invoke the call on the MatrixToken.
     */
    function _createUnwrapDataAndInvoke(
        IMatrixToken matrixToken,
        IWrapAdapter wrapAdapter,
        address underlyingToken,
        address wrappedToken,
        uint256 notionalUnderlying
    ) internal {
        (address callTarget, uint256 callValue, bytes memory callByteData) = wrapAdapter.getUnwrapCallData(underlyingToken, wrappedToken, notionalUnderlying);
        matrixToken.invoke(callTarget, callValue, callByteData);
    }

    /**
     * @dev After a wrap/unwrap operation, check the underlying and wrap token quantities and recalculate
     * the units ((total tokens - airdrop)/ total supply). Then update the position on the MatrixToken.
     */
    function _updatePosition(
        IMatrixToken matrixToken,
        address token,
        uint256 preActionTokenBalance,
        uint256 postActionTokenBalance
    ) internal {
        uint256 newUnit = PositionUtil.calculateDefaultEditPositionUnit(
            matrixToken.totalSupply(),
            preActionTokenBalance,
            postActionTokenBalance,
            matrixToken.getDefaultPositionRealUnit(token).toUint256()
        );

        matrixToken.editDefaultPosition(token, newUnit);
    }

    /**
     * @dev Take snapshot of MatrixToken's balance of underlying and wrapped tokens.
     */
    function _snapshotTargetAssetsBalance(
        IMatrixToken matrixToken,
        address underlyingToken,
        address wrappedToken
    ) internal view returns (uint256, uint256) {
        uint256 underlyingTokenBalance = IERC20(underlyingToken).balanceOf(address(matrixToken));
        uint256 wrapTokenBalance = IERC20(wrappedToken).balanceOf(address(matrixToken));

        return (underlyingTokenBalance, wrapTokenBalance);
    }
}
