// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/protocol-v2/blob/master/contracts/interfaces/ILendingRateOracle.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

/**
 * @title ILendingRateOracle interface
 * @notice Interface for the Aave borrow rate oracle. Provides the average market borrow rate to be used as a base for the stable borrow rate calculations
 */
interface ILendingRateOracle {
  /**
   * @dev returns the market borrow rate in ray
   */
  function getMarketBorrowRate(address asset) external view returns (uint256);

  /**
   * @dev sets the market borrow rate. Rate value must be in ray
   */
  function setMarketBorrowRate(address asset, uint256 rate) external;
}
