// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";

interface IManagerIssuanceHook {
    // ==================== External functions ====================

    function invokePreIssueHook(IMatrixToken matrixToken, uint256 issueQuantity, address sender, address to) external; // prettier-ignore

    function invokePreRedeemHook(IMatrixToken matrixToken, uint256 redeemQuantity, address sender, address to) external; // prettier-ignore
}
