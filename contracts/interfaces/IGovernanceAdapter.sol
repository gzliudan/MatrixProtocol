// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IGovernanceAdapter
 */
interface IGovernanceAdapter {
    // ==================== External functions ====================

    function getVoteCallData(uint256 proposalId, bool support, bytes memory data) external view returns ( address target, uint256 value, bytes memory callData ); // prettier-ignore

    function getDelegateCallData(address delegatee) external view returns ( address target, uint256 value, bytes memory callData); // prettier-ignore

    function getRegisterCallData(address matrixToken) external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore

    function getRevokeCallData() external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore

    function getProposeCallData(bytes memory proposalData) external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore
}
