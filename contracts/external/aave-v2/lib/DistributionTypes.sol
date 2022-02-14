// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/incentives-controller/blob/master/contracts/lib/DistributionTypes.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

library DistributionTypes {
  struct AssetConfigInput {
    uint104 emissionPerSecond;
    uint256 totalStaked;
    address underlyingAsset;
  }

  struct UserStakeInput {
    address underlyingAsset;
    uint256 stakedByUser;
    uint256 totalStaked;
  }
}
