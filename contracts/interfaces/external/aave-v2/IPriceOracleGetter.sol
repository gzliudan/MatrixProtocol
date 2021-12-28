// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/protocol-v2/blob/master/contracts/interfaces/IPriceOracleGetter.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

/**
 * @title IPriceOracleGetter interface
 * @notice Interface for the Aave price oracle.
 */
interface IPriceOracleGetter {
  /**
   * @dev returns the asset price in ETH
   * @param asset the address of the asset
   * @return the ETH price of the asset
   */
  function getAssetPrice(address asset) external view returns (uint256);
}
