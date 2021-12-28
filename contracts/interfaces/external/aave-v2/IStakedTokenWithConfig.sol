// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/incentives-controller/blob/master/contracts/interfaces/IStakedTokenWithConfig.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

import { IStakedToken } from "./IStakedToken.sol";

interface IStakedTokenWithConfig is IStakedToken {
  function STAKED_TOKEN() external view returns(address);
}
