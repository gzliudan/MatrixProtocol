// SPDX-License-Identifier: GPL-3.0-only

// Copy from https://github.com/Uniswap/liquidity-staker/blob/master/contracts/interfaces/IStakingRewards.sol under terms of GPL-3.0 with slight modifications

pragma solidity ^0.8.0;

/**
 * @title IStakingRewards
 */
interface IStakingRewards {
    function balanceOf(address account) external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function stake(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function getReward() external;
}
