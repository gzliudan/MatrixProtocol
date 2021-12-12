// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title IssuanceValidationUtil
 *
 * @dev A collection of utility functions to help during issuance/redemption of MatrixToken.
 */
library IssuanceValidationUtil {
    using SafeCast for int256;
    using PreciseUnitMath for uint256;

    // ==================== Internal functions ====================

    /**
     * @dev Validates component transfer IN to MatrixToken during issuance/redemption. Reverts if matrixToken undercollateralized post transfer.
     * @notice Call this function immediately after transfer IN but before calling external hooks (if any).
     *
     * @param matrixToken          Instance of the MatrixToken being issued/redeemed
     * @param component            Address of component being transferred in/out
     * @param initialSupply        Initial MatrixToken supply before issuance/redemption
     * @param componentQuantity    Amount of component transferred into MatrixToken
     */
    function validateCollateralizationPostTransferInPreHook(
        IMatrixToken matrixToken,
        address component,
        uint256 initialSupply,
        uint256 componentQuantity
    ) internal view {
        uint256 newComponentBalance = IERC20(component).balanceOf(address(matrixToken));
        uint256 defaultPositionUnit = matrixToken.getDefaultPositionRealUnit(address(component)).toUint256();

        // Use preciseMulCeil to increase the lower bound and maintain over-collateralization
        require(newComponentBalance >= initialSupply.preciseMulCeil(defaultPositionUnit) + componentQuantity, "IV0"); // "Invalid transfer in. Results in undercollateralization"
    }

    /**
     * @dev Validates component transfer OUT of MatrixToken during issuance/redemption. Reverts if matrixToken is undercollateralized post transfer.
     *
     * @param matrixToken    Instance of the MatrixToken being issued/redeemed
     * @param component      Address of component being transferred in/out
     * @param finalSupply    Final MatrixToken supply after issuance/redemption
     */
    function validateCollateralizationPostTransferOut(
        IMatrixToken matrixToken,
        address component,
        uint256 finalSupply
    ) internal view {
        uint256 newComponentBalance = IERC20(component).balanceOf(address(matrixToken));
        uint256 defaultPositionUnit = matrixToken.getDefaultPositionRealUnit(address(component)).toUint256();

        // Use preciseMulCeil to increase lower bound and maintain over-collateralization
        require(newComponentBalance >= finalSupply.preciseMulCeil(defaultPositionUnit), "IV1"); // "Invalid transfer out. Results in undercollateralization"
    }
}
