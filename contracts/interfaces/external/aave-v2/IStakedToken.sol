// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/aave-v3-periphery/blob/master/contracts/rewards/interfaces/IStakedToken.sol under terms of agpl-3.0 with slight modifications

// Reference: https://github.com/aave/aave-js/blob/master/contracts/IStakedToken.sol

pragma solidity ^0.8.0;

interface IStakedToken {

  function stake(address to, uint256 amount) external;

  function redeem(address to, uint256 amount) external;

  function cooldown() external;

  function claimRewards(address to, uint256 amount) external;
}
