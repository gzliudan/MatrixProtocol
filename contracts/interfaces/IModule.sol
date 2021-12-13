// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IModule
 *
 * @dev Interface for interacting with Modules.
 */
interface IModule {
    // ==================== External functions ====================

    /**
     * @dev Called by a MatrixToken to notify that this module was removed from the MatrixToken.
     * Any logic can be included in case checks need to be made or state needs to be cleared.
     */
    function removeModule() external;
}
