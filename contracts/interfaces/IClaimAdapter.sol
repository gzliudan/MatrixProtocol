// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";

/**
 * @title IClaimAdapter
 */
interface IClaimAdapter {
    // ==================== External functions ====================

    /**
     * Generates the calldata for claiming tokens from the rewars pool
     *
     * @param matrixToken    the set token that is owed the tokens
     * @param rewardPool     the rewards pool to claim from
     *
     * @return subject       the rewards pool to call
     * @return value         the amount of ether to send in the call
     * @return callData      the calldata to use
     */
    function getClaimCallData(IMatrixToken matrixToken, address rewardPool) external view returns (address subject, uint256 value, bytes memory callData); // prettier-ignore

    /**
     * Gets the amount of unclaimed rewards
     *
     * @param matrixToken    the set token that is owed the tokens
     * @param rewardPool     the rewards pool to check
     *
     * @return uint256       the amount of unclaimed rewards
     */
    function getRewardsAmount(IMatrixToken matrixToken, address rewardPool) external view returns (uint256);

    /**
     * Gets the rewards token
     *
     * @param rewardPool    the rewards pool to check
     *
     * @return IERC20       the reward token
     */
    function getTokenAddress(address rewardPool) external view returns (IERC20);
}
