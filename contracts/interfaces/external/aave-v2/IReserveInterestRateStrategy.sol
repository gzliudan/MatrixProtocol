// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/protocol-v2/blob/master/contracts/interfaces/IReserveInterestRateStrategy.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

/**
 * @title IReserveInterestRateStrategyInterface interface
 * @dev Interface for the calculation of the interest rates
 * @author Aave
 */
interface IReserveInterestRateStrategy {
  function baseVariableBorrowRate() external view returns (uint256);

  function getMaxVariableBorrowRate() external view returns (uint256);

  function calculateInterestRates(
    address reserve,
    uint256 availableLiquidity,
    uint256 totalStableDebt,
    uint256 totalVariableDebt,
    uint256 averageStableBorrowRate,
    uint256 reserveFactor
  )
    external
    view
    returns (
      uint256,
      uint256,
      uint256
    );

  function calculateInterestRates(
    address reserve,
    address aToken,
    uint256 liquidityAdded,
    uint256 liquidityTaken,
    uint256 totalStableDebt,
    uint256 totalVariableDebt,
    uint256 averageStableBorrowRate,
    uint256 reserveFactor
  )
    external
    view
    returns (
      uint256 liquidityRate,
      uint256 stableBorrowRate,
      uint256 variableBorrowRate
    );
}
