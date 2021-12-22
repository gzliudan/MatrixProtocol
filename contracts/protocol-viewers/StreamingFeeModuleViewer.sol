// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";
import { IStreamingFeeModule } from "../interfaces/IStreamingFeeModule.sol";

/**
 * @title StreamingFeeModuleViewer
 *
 * @dev enables batch queries of StreamingFeeModule state.
 */
contract StreamingFeeModuleViewer {
    // ==================== Structs ====================

    struct StreamingFeeInfo {
        uint256 streamingFeePercentage;
        uint256 unaccruedFees;
        address feeRecipient;
    }

    // ==================== External functions ====================

    function batchFetchStreamingFeeInfo(IStreamingFeeModule streamingFeeModule, IMatrixToken[] memory matrixTokens)
        external
        view
        returns (StreamingFeeInfo[] memory)
    {
        StreamingFeeInfo[] memory feeInfo = new StreamingFeeInfo[](matrixTokens.length);

        for (uint256 i = 0; i < matrixTokens.length; i++) {
            IStreamingFeeModule.FeeState memory feeState = streamingFeeModule.getFeeState(matrixTokens[i]);
            uint256 unaccruedFees = streamingFeeModule.getFee(matrixTokens[i]);

            feeInfo[i] = StreamingFeeInfo({
                streamingFeePercentage: feeState.streamingFeePercentage,
                unaccruedFees: unaccruedFees,
                feeRecipient: feeState.feeRecipient
            });
        }

        return feeInfo;
    }
}
