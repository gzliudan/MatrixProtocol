// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IStakingAdapter
 */
interface IStakingAdapter {
    // ==================== External functions ====================

    function getSpenderAddress(address stakingContract) external view returns (address);

    function getStakeCallData(address stakingContract, uint256 notionalAmount) external view returns (address, uint256, bytes memory); // prettier-ignore

    function getUnstakeCallData(address stakingContract, uint256 notionalAmount) external view returns (address, uint256, bytes memory); // prettier-ignore
}
