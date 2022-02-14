// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/protocol-v2/blob/master/contracts/mocks/oracle/LendingRateOracle.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

// ==================== Internal Imports ====================

import { ILendingRateOracle } from "../../interfaces/external/aave-v2/ILendingRateOracle.sol";

contract LendingRateOracle is ILendingRateOracle, Ownable {
  mapping(address => uint256) borrowRates;
  mapping(address => uint256) liquidityRates;

  function getMarketBorrowRate(address _asset) external view override returns (uint256) {
    return borrowRates[_asset];
  }

  function setMarketBorrowRate(address _asset, uint256 _rate) external override onlyOwner {
    borrowRates[_asset] = _rate;
  }

  function getMarketLiquidityRate(address _asset) external view returns (uint256) {
    return liquidityRates[_asset];
  }

  function setMarketLiquidityRate(address _asset, uint256 _rate) external onlyOwner {
    liquidityRates[_asset] = _rate;
  }
}
