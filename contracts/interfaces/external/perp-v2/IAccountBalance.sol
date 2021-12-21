// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IAccountBalance
 */
interface IAccountBalance {
    // ==================== External functions ====================

    function getBaseTokens(address trader) external view returns (address[] memory);

    function hasOrder(address trader) external view returns (bool);

    function getMarginRequirementForLiquidation(address trader) external view returns (int256);

    function getTotalDebtValue(address trader) external view returns (uint256);

    function getPnlAndPendingFee(address trader) external view returns (int256, int256, uint256); // prettier-ignore

    function getBase(address trader, address baseToken) external view returns (int256);

    function getQuote(address trader, address baseToken) external view returns (int256);

    function getNetQuoteBalanceAndPendingFee(address trader) external view returns (int256, uint256);

    function getPositionSize(address trader, address baseToken) external view returns (int256);

    function getPositionValue(address trader, address baseToken) external view returns (int256);

    function getTotalAbsPositionValue(address trader) external view returns (uint256);

    function getClearingHouseConfig() external view returns (address);

    function getExchange() external view returns (address);

    function getOrderBook() external view returns (address);

    function getVault() external view returns (address);
}
