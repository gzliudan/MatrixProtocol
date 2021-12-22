// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { Erc20Viewer } from "./Erc20Viewer.sol";
import { MatrixTokenViewer } from "./MatrixTokenViewer.sol";
import { StreamingFeeModuleViewer } from "./StreamingFeeModuleViewer.sol";

/**
 * @title ProtocolViewer
 *
 * @dev enables batch queries of various protocol state.
 */
contract ProtocolViewer is Erc20Viewer, MatrixTokenViewer, StreamingFeeModuleViewer {
    // ==================== Constructor function ====================

    constructor() {}
}
