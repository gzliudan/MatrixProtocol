// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "./IMatrixToken.sol";

/**
 * @title IStreamingFeeModule
 */
interface IStreamingFeeModule {
    // ==================== Structs ====================

    struct FeeState {
        uint256 maxStreamingFeePercentage; // Max streaming fee maanager commits to using (1% = 1e16, 100% = 1e18)
        uint256 streamingFeePercentage; // Percent of Matrix accruing to manager annually (1% = 1e16, 100% = 1e18)
        uint256 lastStreamingFeeTimestamp; // Timestamp last streaming fee was accrued
        address feeRecipient; // Address to accrue fees to
    }

    // ==================== Events ====================

    event ActualizeFee(address indexed matrixToken, uint256 managerFee, uint256 protocolFee);
    event UpdateStreamingFee(address indexed matrixToken, uint256 newStreamingFee);
    event UpdateFeeRecipient(address indexed matrixToken, address newFeeRecipient);

    // ==================== External functions ====================

    function getFeeState(IMatrixToken matrixToken) external view returns (FeeState memory);

    function getFee(IMatrixToken matrixToken) external view returns (uint256);
}
