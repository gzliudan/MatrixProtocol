// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";

import { PositionUtil } from "../lib/PositionUtil.sol";
import { IssuanceValidationUtil } from "../lib/IssuanceValidationUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

import { DebtIssuanceModule } from "./DebtIssuanceModule.sol";

/**
 * @title DebtIssuanceModuleV2
 *
 * @dev The DebtIssuanceModuleV2 is a module that enables users to issue and redeem MatrixToken that contain default and all
 * external positions, including debt positions. Module hooks are added to allow for syncing of positions, and component
 * level hooks are added to ensure positions are replicated correctly. The manager can define arbitrary issuance logic
 * in the manager hook, as well as specify issue and redeem fees.
 *
 * @notice DebtIssuanceModule contract confirms increase/decrease in balance of component held by the MatrixToken after every transfer
 * in/out for each component during issuance/redemption. This contract replaces those strict checks with slightly looser checks which
 * ensure that the MatrixToken remains collateralized after every transfer in/out for each component during issuance/redemption.
 * This module should be used to issue/redeem MatrixToken whose one or more components return a balance value with +/-1 wei error.
 * For example, this module can be used to issue/redeem MatrixToken which has one or more aTokens as its components.
 * The new checks do NOT apply to any transfers that are part of an external position. A token that has rounding issues may lead to
 * reverts if it is included as an external position unless explicitly allowed in a module hook.
 *
 * The getRequiredComponentIssuanceUnits function on this module assumes that Default token balances will be synced on every issuance
 * and redemption. If token balances are not being synced it will over-estimate the amount of tokens required to issue a MatrixToken.
 */
contract DebtIssuanceModuleV2 is DebtIssuanceModule {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SignedMath for int256;
    using ExactSafeErc20 for IERC20;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;

    // ==================== Constructor function ====================

    constructor(IController controller) DebtIssuanceModule(controller) {}

    // ==================== External functions ====================

    /**
     * @dev Calculates the amount of each component needed to collateralize passed issue quantity plus fees of MatrixToken as well as amount of debt
     * that will be returned to caller. Default equity alues are calculated based on token balances and not position units in order to more
     * closely track any accrued tokens that will be synced during issuance. External equity and debt positions will use the stored position
     * units. IF TOKEN VALUES ARE NOT BEING SYNCED DURING ISSUANCE THIS FUNCTION WILL OVER ESTIMATE THE AMOUNT OF REQUIRED TOKENS.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixToken to be issued
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentIssuanceUnits(IMatrixToken matrixToken, uint256 quantity)
        external
        view
        override
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        (uint256 totalQuantity, , ) = calculateTotalFees(matrixToken, quantity, true);

        if (matrixToken.totalSupply() == 0) {
            return _calculateRequiredComponentIssuanceUnits(matrixToken, totalQuantity, true);
        } else {
            (components, totalEquityUnits, totalDebtUnits) = _getTotalIssuanceUnitsFromBalances(matrixToken);

            for (uint256 i = 0; i < components.length; i++) {
                // Use preciseMulCeil to round up to ensure overcollateration of equity when small issue quantities are provided
                // and use preciseMul to round debt calculations down to make sure we don't return too much debt to issuer
                totalEquityUnits[i] = totalEquityUnits[i].preciseMulCeil(totalQuantity);
                totalDebtUnits[i] = totalDebtUnits[i].preciseMul(totalQuantity);
            }
        }
    }

    /**
     * @dev Deposits components to the MatrixToken, replicates any external module component positions and mints
     * the MatrixToken. If the token has a debt position all collateral will be transferred in first then debt
     * will be returned to the minting address. If specified, a fee will be charged on issuance.
     *
     * NOTE: Overrides DebtIssuanceModule#issue external function and adds undercollateralization checks in place of the
     * previous default strict balances checks. The undercollateralization checks are implemented in IssuanceValidationUtils library and they
     * revert upon undercollateralization of the MatrixToken post component transfer.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     * @param quantity       Quantity of MatrixToken to issue
     * @param to             Address to mint MatrixToken to
     */
    function issue(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external override nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "Db0"); // "Issue quantity must be > 0"

        address hookContract = _callManagerPreIssueHooks(matrixToken, quantity, msg.sender, to);

        _callModulePreIssueHooks(matrixToken, quantity);

        (uint256 quantityWithFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, quantity, true);

        // Prevent stack too deep
        {
            (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
                matrixToken,
                quantityWithFees,
                true
            );

            uint256 initialSupply = matrixToken.totalSupply();
            uint256 finalSupply = initialSupply + quantityWithFees;
            _resolveEquityPositions(matrixToken, quantityWithFees, to, true, components, equityUnits, initialSupply, finalSupply);
            _resolveDebtPositions(matrixToken, quantityWithFees, true, components, debtUnits, initialSupply, finalSupply);
            _resolveFees(matrixToken, managerFee, protocolFee);
        }

        matrixToken.mint(to, quantity);

        emit IssueMatrixToken(matrixToken, msg.sender, to, hookContract, quantity, managerFee, protocolFee);
    }

    /**
     * @dev Returns components from the MatrixToken, unwinds any external module component positions and burns the MatrixToken.
     * If the token has debt positions, the module transfers in the required debt amounts from the caller and uses
     * those funds to repay the debts on behalf of the MatrixToken. All debt will be paid down first then equity positions
     * will be returned to the minting address. If specified, a fee will be charged on redeem.
     *
     * @notice Overrides DebtIssuanceModule#redeem internal function and adds undercollateralization checks in place of the
     * previous default strict balances checks. The undercollateralization checks are implemented in IssuanceValidationUtils library
     * and they revert upon undercollateralization of the MatrixToken post component transfer.
     *
     * @param matrixToken    Instance of the MatrixToken to redeem
     * @param quantity       Quantity of MatrixToken to redeem
     * @param to             Address to send collateral to
     */
    function redeem(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external override nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "Db1"); // "Redeem quantity must be > 0"

        _callModulePreRedeemHooks(matrixToken, quantity);

        uint256 initialSupply = matrixToken.totalSupply();

        // Place burn after pre-redeem hooks because burning tokens may lead to false accounting of synced positions
        matrixToken.burn(msg.sender, quantity);

        (uint256 quantityNetFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, quantity, false);

        // Prevent stack too deep
        {
            (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
                matrixToken,
                quantityNetFees,
                false
            );

            uint256 finalSupply = initialSupply - quantityNetFees;
            _resolveDebtPositions(matrixToken, quantityNetFees, false, components, debtUnits, initialSupply, finalSupply);
            _resolveEquityPositions(matrixToken, quantityNetFees, to, false, components, equityUnits, initialSupply, finalSupply);
            _resolveFees(matrixToken, managerFee, protocolFee);
        }

        emit RedeemMatrixToken(matrixToken, msg.sender, to, quantity, managerFee, protocolFee);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Resolve equity positions associated with MatrixToken. On issuance, the total equity position for an asset
     * (including default and external positions) is transferred in. Then any external position hooks are called
     * to transfer the external positions to their necessary place. On redemption all external positions are recalled
     * by the external position hook, then those position plus any default position are transferred back to the to address.
     */
    function _resolveEquityPositions(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to,
        bool isIssue,
        address[] memory components,
        uint256[] memory componentEquityQuantities,
        uint256 initialMatrixSupply,
        uint256 finalMatrixSupply
    ) internal {
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            uint256 componentQuantity = componentEquityQuantities[i];

            if (componentQuantity > 0) {
                if (isIssue) {
                    // Call SafeERC20#safeTransferFrom instead of ExplicitERC20#transferFrom
                    SafeERC20.safeTransferFrom(IERC20(component), msg.sender, address(matrixToken), componentQuantity);
                    IssuanceValidationUtil.validateCollateralizationPostTransferInPreHook(matrixToken, component, initialMatrixSupply, componentQuantity);
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), true, true);
                } else {
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), false, true);
                    // Call Invoke#invokeTransfer instead of Invoke#strictInvokeTransfer
                    matrixToken.invokeSafeTransfer(component, to, componentQuantity);
                    IssuanceValidationUtil.validateCollateralizationPostTransferOut(matrixToken, component, finalMatrixSupply);
                }
            }
        }
    }

    /**
     * @dev Resolve debt positions associated with MatrixToken. On issuance, debt positions are entered into by calling the external position hook. The
     * resulting debt is then returned to the calling address. On redemption, the module transfers in the required debt amount from the caller
     * and uses those funds to repay the debt on behalf of the MatrixToken.
     */
    function _resolveDebtPositions(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue,
        address[] memory components,
        uint256[] memory componentDebtQuantities,
        uint256 initialMatrixSupply,
        uint256 finalMatrixSupply
    ) internal {
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            uint256 componentQuantity = componentDebtQuantities[i];

            if (componentQuantity > 0) {
                if (isIssue) {
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), true, false);
                    // Call Invoke#invokeTransfer instead of Invoke#strictInvokeTransfer
                    matrixToken.invokeSafeTransfer(component, msg.sender, componentQuantity);
                    IssuanceValidationUtil.validateCollateralizationPostTransferOut(matrixToken, component, finalMatrixSupply);
                } else {
                    // Call SafeERC20#safeTransferFrom instead of ExplicitERC20#transferFrom
                    SafeERC20.safeTransferFrom(IERC20(component), msg.sender, address(matrixToken), componentQuantity);

                    IssuanceValidationUtil.validateCollateralizationPostTransferInPreHook(matrixToken, component, initialMatrixSupply, componentQuantity);

                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), false, false);
                }
            }
        }
    }

    /**
     * @dev Reimplementation of _getTotalIssuanceUnits but instead derives Default equity positions from token balances on MatrixToken instead of from
     * position units. This function is ONLY to be used in getRequiredComponentIssuanceUnits in order to return more accurate required
     * token amounts to issuers when positions are being synced on issuance.
     *
     * @param matrixToken     Instance of the MatrixToken to issue
     *
     * @return components     Array of component addresses making up the MatrixToken
     * @return equityUnits    Array of equity unit amounts of each component, respectively, represented as uint256
     * @return debtUnits      Array of debt unit amounts of each component, respectively, represented as uint256
     */
    function _getTotalIssuanceUnitsFromBalances(IMatrixToken matrixToken)
        internal
        view
        returns (
            address[] memory components,
            uint256[] memory equityUnits,
            uint256[] memory debtUnits
        )
    {
        components = matrixToken.getComponents();
        equityUnits = new uint256[](components.length);
        debtUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];

            int256 cumulativeEquity = PositionUtil
                .getDefaultPositionUnit(matrixToken.totalSupply(), IERC20(component).balanceOf(address(matrixToken)))
                .toInt256();

            address[] memory externalPositions = matrixToken.getExternalPositionModules(component);
            if (externalPositions.length > 0) {
                int256 cumulativeDebt = 0;

                for (uint256 j = 0; j < externalPositions.length; j++) {
                    int256 externalPositionUnit = matrixToken.getExternalPositionRealUnit(component, externalPositions[j]);

                    // If positionUnit <= 0 it will be "added" to debt position
                    if (externalPositionUnit > 0) {
                        cumulativeEquity += externalPositionUnit;
                    } else {
                        cumulativeDebt += externalPositionUnit;
                    }
                }

                debtUnits[i] = cumulativeDebt.abs();
            }

            equityUnits[i] = cumulativeEquity.toUint256();
        }
    }
}
