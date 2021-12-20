// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "./IMatrixToken.sol";

/**
 * @title INavIssuanceHook
 */
interface INavIssuanceHook {
    // ==================== External functions ====================

    function invokePreIssueHook(IMatrixToken matrixToken, address reserveAsset, uint256 reserveAssetQuantity, address sender, address to) external; // prettier-ignore

    function invokePreRedeemHook(IMatrixToken matrixToken, uint256 redeemQuantity, address sender, address to) external; // prettier-ignore
}
