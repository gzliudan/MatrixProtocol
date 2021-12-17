// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "./IMatrixToken.sol";

/**
 * @title IModuleIssuanceHookV2
 */
interface IModuleIssuanceHookV2 {
    // ==================== External functions ====================

    function moduleIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external;

    function moduleRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external;

    function componentIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity, IERC20 component, bool isEquity) external; // prettier-ignore

    function componentRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity, IERC20 component, bool isEquity) external; // prettier-ignore

    /**
     * @dev Adjustments should return the NET CHANGE in POSITION UNITS for each component in the MatrixToken's
     * components array (i.e. if debt is greater than current debt position unit return negative number).
     * Each entry in the returned arrays should index to the same component in the MatrixToken's components
     * array (called using getComponents()).
     */
    function getIssuanceAdjustments(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external returns (int256[] memory, int256[] memory);

    /**
     * Adjustments should return the NET CHANGE in POSITION UNITS for each component in the MatrixToken's
     * components array (i.e. if debt is greater than current debt position unit return negative number).
     * Each entry in the returned arrays should index to the same component in the MatrixToken's components
     * array (called using getComponents()).
     */
    function getRedemptionAdjustments(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external returns (int256[] memory, int256[] memory);
}
