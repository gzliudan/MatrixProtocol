// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "./IMatrixToken.sol";

/**
 * @title IDebtIssuanceModule
 *
 * @dev Interface for interacting with Debt Issuance module interface.
 */
interface IDebtIssuanceModule {
    // ==================== External functions ====================

    /**
     * @dev Called by another module to register itself on debt issuance module.
     * Any logic can be included in case checks need to be made or state needs to be updated.
     */
    function registerToIssuanceModule(IMatrixToken matrixToken) external;

    /**
     * @dev Called by another module to unregister itself on debt issuance module.
     * Any logic can be included in case checks need to be made or state needs to be cleared.
     */
    function unregisterFromIssuanceModule(IMatrixToken matrixToken) external;
}
