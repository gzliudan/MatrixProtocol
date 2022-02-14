// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/protocol-v2/blob/master/contracts/protocol/lendingpool/LendingPoolStorage.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { DataTypes } from "./lib/DataTypes.sol";
import { ReserveLogic } from "./lib/ReserveLogic.sol";
import { UserConfiguration } from "./lib/UserConfiguration.sol";
import { ReserveConfiguration } from "./lib/ReserveConfiguration.sol";

import { ILendingPoolAddressesProvider } from '../../interfaces/external/aave-v2/ILendingPoolAddressesProvider.sol';

contract LendingPoolStorage {
  using ReserveLogic for DataTypes.ReserveData;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
  using UserConfiguration for DataTypes.UserConfigurationMap;

  ILendingPoolAddressesProvider internal _addressesProvider;

  mapping(address => DataTypes.ReserveData) internal _reserves;
  mapping(address => DataTypes.UserConfigurationMap) internal _usersConfig;

  // the list of the available reserves, structured as a mapping for gas savings reasons
  mapping(uint256 => address) internal _reservesList;

  uint256 internal _reservesCount;

  bool internal _paused;

  uint256 internal _maxStableRateBorrowSizePercent;

  uint256 internal _flashLoanPremiumTotal;

  uint256 internal _maxNumberOfReserves;
}
