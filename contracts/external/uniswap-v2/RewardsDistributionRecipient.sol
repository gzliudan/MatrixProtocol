// SPDX-License-Identifier: GPL-3.0-only

// Copy from https://github.com/Uniswap/liquidity-staker/blob/master/contracts/RewardsDistributionRecipient.sol under terms of GPL-3.0 with slight modifications

pragma solidity ^0.8.0;

abstract contract RewardsDistributionRecipient {
    address public rewardsDistribution;

    function notifyRewardAmount(uint256 reward) external virtual;

    modifier onlyRewardsDistribution() {
        require(msg.sender == rewardsDistribution, "Caller is not RewardsDistribution contract");
        _;
    }
}
