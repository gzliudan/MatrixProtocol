// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IModuleIssuanceHookV2 } from "../../interfaces/IModuleIssuanceHookV2.sol";

import { DebtIssuanceModule } from "./DebtIssuanceModule.sol";

/**
 * @title SlippageIssuanceModule
 *
 * @dev The SlippageIssuanceModule is a module that enables users to issue and redeem MatrixTokens that requires a transaction that incurs slippage
 * in order to replicate the MatrixToken. Like the DebtIssuanceModule, module hooks are added to allow for syncing of positions, and component
 * level hooks are added to ensure positions are replicated correctly. The manager can define arbitrary issuance logic in the manager hook,
 * as well as specify issue and redeem fees. The getRequiredComponentIssuanceUnits and it's redemption counterpart now also include any
 * changes to the position expected to happen during issuance thus providing much better estimations for positions that are synced or require
 * a trade. It is worth noting that this module inherits from DebtIssuanceModule, consequently it can also be used for issuances that do NOT
 * require slippage just by calling the issue and redeem endpoints.
 */
contract SlippageIssuanceModule is DebtIssuanceModule {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];

    // ==================== Constructor function ====================

    constructor(IController controller) DebtIssuanceModule(controller) {}

    // ==================== External functions ====================

    /**
     * @dev Deposits components to the MatrixToken, replicates any external module component positions and mints
     * the MatrixToken. If the token has a debt position all collateral will be transferred in first then debt
     * will be returned to the minting address. If specified, a fee will be charged on issuance. Issuer can
     * also pass in a max amount of tokens they are willing to pay for each component. They are NOT required
     * to pass in a limit for every component, and may in fact only want to pass in limits for components which
     * incur slippage to replicate (i.e. perpetuals). Passing in empty arrays for _checkComponents and
     * maxTokenAmountsIn is equivalent to calling issue.
     * @notice not passing in limits for positions that require a trade for replication leaves the issuer open to sandwich attacks!
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param matrixQuantity       Quantity of MatrixToken to issue
     * @param checkedComponents    Components to be checked that collateral doesn't exceed defined max. Each entry must be unique.
     * @param maxTokenAmountsIn    Max amount of component willing to transfer in to collateralize matrixQuantity amount of matrixToken.
     * @param to                   Address to mint MatrixToken to
     */
    function issueWithSlippage(
        IMatrixToken matrixToken,
        uint256 matrixQuantity,
        address[] memory checkedComponents,
        uint256[] memory maxTokenAmountsIn,
        address to
    ) external virtual nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _validateInputs(matrixQuantity, checkedComponents, maxTokenAmountsIn);
        address hookContract = _callManagerPreIssueHooks(matrixToken, matrixQuantity, msg.sender, to);
        _callModulePreIssueHooks(matrixToken, matrixQuantity);

        bool isIssue = true;
        (uint256 quantityWithFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, matrixQuantity, isIssue);

        // Scoping logic to avoid stack too deep errors
        {
            (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
                matrixToken,
                quantityWithFees,
                isIssue
            );

            // Validate the required token amounts don't exceed those passed by issuer
            _validateTokenTransferLimits(checkedComponents, maxTokenAmountsIn, components, equityUnits, isIssue);

            _resolveEquityPositions(matrixToken, quantityWithFees, to, isIssue, components, equityUnits);
            _resolveDebtPositions(matrixToken, quantityWithFees, isIssue, components, debtUnits);
            _resolveFees(matrixToken, managerFee, protocolFee);
        }

        matrixToken.mint(to, matrixQuantity);

        emit IssueMatrixToken(matrixToken, msg.sender, to, hookContract, matrixQuantity, managerFee, protocolFee);
    }

    /**
     * @dev Returns components from the MatrixToken, unwinds any external module component positions and burns the MatrixToken.
     * If the token has debt positions, the module transfers in the required debt amounts from the caller and uses
     * those funds to repay the debts on behalf of the MatrixToken. All debt will be paid down first then equity positions
     * will be returned to the minting address. If specified, a fee will be charged on redeem. Redeemer can
     * also pass in a min amount of tokens they want to receive for each component. They are NOT required
     * to pass in a limit for every component, and may in fact only want to pass in limits for components which
     * incur slippage to replicate (i.e. perpetuals). Passing in empty arrays for _checkComponents and
     * minTokenAmountsOut is equivalent to calling redeem.
     * @notice not passing in limits for positions that require a trade for replication leaves the redeemer open to sandwich attacks!
     *
     * @param matrixToken           Instance of the MatrixToken to redeem
     * @param matrixQuantity        Quantity of MatrixToken to redeem
     * @param checkedComponents     Components to be checked that received collateral isn't less than defined min. Each entry must be unique.
     * @param minTokenAmountsOut    Min amount of component willing to receive to redeem matrixQuantity amount of matrixToken.
     * @param to                    Address to send collateral to
     */
    function redeemWithSlippage(
        IMatrixToken matrixToken,
        uint256 matrixQuantity,
        address[] memory checkedComponents,
        uint256[] memory minTokenAmountsOut,
        address to
    ) external virtual nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _validateInputs(matrixQuantity, checkedComponents, minTokenAmountsOut);
        _callModulePreRedeemHooks(matrixToken, matrixQuantity);

        // Place burn after pre-redeem hooks because burning tokens may lead to false accounting of synced positions
        matrixToken.burn(msg.sender, matrixQuantity);

        bool isIssue = false;
        (uint256 quantityNetFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, matrixQuantity, isIssue);
        (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
            matrixToken,
            quantityNetFees,
            isIssue
        );

        // Validate the required token amounts don't exceed those passed by redeemer
        _validateTokenTransferLimits(checkedComponents, minTokenAmountsOut, components, equityUnits, isIssue);

        _resolveDebtPositions(matrixToken, quantityNetFees, isIssue, components, debtUnits);
        _resolveEquityPositions(matrixToken, quantityNetFees, to, isIssue, components, equityUnits);
        _resolveFees(matrixToken, managerFee, protocolFee);

        emit RedeemMatrixToken(matrixToken, msg.sender, to, matrixQuantity, managerFee, protocolFee);
    }

    // ==================== External functions ====================

    /**
     * @dev Calculates the amount of each component needed to collateralize passed issue quantity plus fees of Sets as well as
     * amount of debt that will be returned to caller. Takes into account position updates from pre action module hooks.
     * (manager hooks not included).
     *
     * @notice This getter is non-view to allow module hooks to determine units by simulating state changes
     * in an external protocol and reverting. It should only be called by off-chain methods via static call.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixTokens to be issued
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentIssuanceUnitsOffChain(IMatrixToken matrixToken, uint256 quantity)
        external
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        bool isIssue = true;
        (uint256 totalQuantity, , ) = calculateTotalFees(matrixToken, quantity, isIssue);
        (int256[] memory equityIssuanceAdjustments, int256[] memory debtIssuanceAdjustments) = _calculateAdjustments(matrixToken, totalQuantity, isIssue);

        return _calculateAdjustedComponentIssuanceUnits(matrixToken, totalQuantity, isIssue, equityIssuanceAdjustments, debtIssuanceAdjustments);
    }

    /**
     * @dev Calculates the amount of each component that will be returned on redemption net of fees as well as how much debt
     * needs to be paid down to redeem. Takes into account position updates from pre action module hooks (manager hooks not included).
     *
     * @notice This getter is non-view to allow module hooks to determine units by simulating state changes
     * in an external protocol and reverting. It should only be called by off-chain methods via static call.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixTokens to be redeemed
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentRedemptionUnitsOffChain(IMatrixToken matrixToken, uint256 quantity)
        external
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        bool isIssue = false;
        (uint256 totalQuantity, , ) = calculateTotalFees(matrixToken, quantity, isIssue);
        (int256[] memory equityRedemptionAdjustments, int256[] memory debtRedemptionAdjustments) = _calculateAdjustments(matrixToken, totalQuantity, isIssue);

        return _calculateAdjustedComponentIssuanceUnits(matrixToken, totalQuantity, isIssue, equityRedemptionAdjustments, debtRedemptionAdjustments);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Similar to _calculateRequiredComponentIssuanceUnits but adjustments for positions that will be updated DURING the issue
     * or redeem process are added in. Adjustments can be either positive or negative, a negative debt adjustment means there
     * is less debt than the pre-issue position unit indicates there will be.
     *
     * @param matrixToken          Instance of the MatrixToken to redeem
     * @param quantity             Quantity of MatrixToken to redeem
     * @param isIssue              Whether MatrixToken is being issues
     * @param equityAdjustments    Equity position unit adjustments that account for position changes during issuance
     * @param debtAdjustments      Debt position unit adjustments that account for position changes during issuance
     */
    function _calculateAdjustedComponentIssuanceUnits(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue,
        int256[] memory equityAdjustments,
        int256[] memory debtAdjustments
    )
        internal
        view
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        (components, totalEquityUnits, totalDebtUnits) = _getTotalIssuanceUnits(matrixToken);

        for (uint256 i = 0; i < components.length; i++) {
            // NOTE: If equityAdjustment is negative and exceeds equityUnits in absolute value this will revert
            // When adjusting units if we have MORE equity as a result of issuance (ie adjustment is positive)
            // we want to add that to the unadjusted equity units hence we use addition.
            // Vice versa if we want to remove equity, the adjustment is negative hence adding adjusts the units lower
            uint256 adjustedEquityUnits = (totalEquityUnits[i].toInt256() + equityAdjustments[i]).toUint256();

            // Use preciseMulCeil to round up to ensure overcollateration when small issue quantities are provided
            // and preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            totalEquityUnits[i] = isIssue ? adjustedEquityUnits.preciseMulCeil(quantity) : adjustedEquityUnits.preciseMul(quantity);

            // NOTE: If debtAdjustment is negative and exceeds debtUnits in absolute value this will revert
            // When adjusting units if we have MORE debt as a result of issuance (ie adjustment is negative) we want to increase
            // the unadjusted debt units hence we subtract. Vice versa if we want to remove debt the adjustment is positive
            // hence subtracting adjusts the units lower.
            uint256 adjustedDebtUnits = (totalDebtUnits[i].toInt256() - debtAdjustments[i]).toUint256();

            // Use preciseMulCeil to round up to ensure overcollateration when small redeem quantities are provided
            // and preciseMul to round down to ensure overcollateration when small issue quantities are provided
            totalDebtUnits[i] = isIssue ? adjustedDebtUnits.preciseMul(quantity) : adjustedDebtUnits.preciseMulCeil(quantity);
        }
    }

    /**
     * @dev Calculates all equity and debt adjustments that will be made to the positionUnits within the context of the current chain
     * state. Each module that registers a hook with the SlippageIssuanceModule is cycled through and returns how the module will
     * adjust the equity and debt positions for the MatrixToken. All changes are summed/netted against each other. The adjustment arrays
     * returned by each module are ordered according to the components array on the MatrixToken.
     *
     * @param matrixToken    Instance of the MatrixToken to redeem
     * @param quantity       Quantity of MatrixToken to redeem
     * @param isIssue        Whether MatrixToken is being issues
     */
    function _calculateAdjustments(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue
    ) internal returns (int256[] memory cumulativeEquityAdjustments, int256[] memory cumulativeDebtAdjustments) {
        uint256 componentsLength = matrixToken.getComponents().length;
        cumulativeEquityAdjustments = new int256[](componentsLength);
        cumulativeDebtAdjustments = new int256[](componentsLength);

        address[] memory issuanceHooks = _issuanceSettings[matrixToken].moduleIssuanceHooks;
        for (uint256 i = 0; i < issuanceHooks.length; i++) {
            (int256[] memory equityAdjustments, int256[] memory debtAdjustments) = isIssue
                ? IModuleIssuanceHookV2(issuanceHooks[i]).getIssuanceAdjustments(matrixToken, quantity)
                : IModuleIssuanceHookV2(issuanceHooks[i]).getRedemptionAdjustments(matrixToken, quantity);

            for (uint256 j = 0; j < componentsLength; j++) {
                cumulativeEquityAdjustments[j] += equityAdjustments[j];
                cumulativeDebtAdjustments[j] += debtAdjustments[j];
            }
        }
    }

    /**
     * @dev Validates that the required token amounts to replicate/redeem an equity position are not greater or less than the limits
     * defined by the issuer/redeemer. Every component is NOT required to be checked however each checked component MUST be a
     * valid component for the MatrixToken.
     *
     * @param checkedComponents       Components the issuer/redeemer wants checked
     * @param tokenTransferLimits     If isIssue: max amount of component allowed to xfer; else min amount of of component the redeemer wants to receive
     * @param components              Array of MatrixToken components
     * @param tokenTransferAmounts    Amount of component required for issuance or returned for redemption, maps to components
     * @param isIssue                 Whether MatrixToken is being issues
     */
    function _validateTokenTransferLimits(
        address[] memory checkedComponents,
        uint256[] memory tokenTransferLimits,
        address[] memory components,
        uint256[] memory tokenTransferAmounts,
        bool isIssue
    ) internal pure {
        for (uint256 i = 0; i < checkedComponents.length; i++) {
            (uint256 componentIndex, bool isIn) = components.indexOf(checkedComponents[i]);

            require(isIn, "SI0a"); // "Limit passed for invalid component"

            isIssue
                ? require(tokenTransferLimits[i] >= tokenTransferAmounts[componentIndex], "SI0b") // "Too many tokens required for issuance"
                : require(tokenTransferLimits[i] <= tokenTransferAmounts[componentIndex], "SI0c"); // "Too few tokens returned for redemption"
        }
    }

    /**
     * @dev Validates matrixQuantity great than 0 and that arrays are of equal length and components are not duplicated.
     */
    function _validateInputs(uint256 matrixQuantity, address[] memory components, uint256[] memory componentLimits) internal pure {
        require(matrixQuantity > 0, "SI1a");    // "MatrixToken quantity must be > 0"
        require(components.length == componentLimits.length, "SI1b"); // "Array length mismatch")
        require(!components.hasDuplicate(), "SI1c"); // "Cannot duplicate addresses"
    } // prettier-ignore
}
