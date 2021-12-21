// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IVault
 */
interface IVault {
    function getBalance(address account) external view returns (int256);

    function decimals() external view returns (uint8);

    function getFreeCollateral(address trader) external view returns (uint256);

    function getFreeCollateralByRatio(address trader, uint24 ratio) external view returns (int256);

    function getLiquidateMarginRequirement(address trader) external view returns (int256);

    function getSettlementToken() external view returns (address);

    function getAccountBalance() external view returns (address);

    function getClearingHouse() external view returns (address);

    function getExchange() external view returns (address);
}
