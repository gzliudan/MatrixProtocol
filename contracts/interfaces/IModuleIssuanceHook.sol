// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "./IMatrixToken.sol";

/**
 * @title IModuleIssuanceHook
 */
interface IModuleIssuanceHook {
    // ==================== External functions ====================

    function moduleIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external;

    function moduleRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external;

    function componentIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity, IERC20 component, bool isEquity) external; // prettier-ignore

    function componentRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity, IERC20 component, bool isEquity) external; // prettier-ignore
}
