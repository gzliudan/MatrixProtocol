// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";

/**
 * @title IMatrixValuer
 */
interface IMatrixValuer {
    // ==================== External functions ====================

    function calculateMatrixTokenValuation(IMatrixToken matrixToken, address quoteAsset) external view returns (uint256);
}
