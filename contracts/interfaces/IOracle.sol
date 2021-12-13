// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IOracle
 */
interface IOracle {
    // ==================== External functions ====================

    function read() external view returns (uint256);
}
