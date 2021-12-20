// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ICErc20
 *
 * @dev Interface for interacting with Compound cErc20 tokens (e.g. Dai, USDC)
 */
interface ICErc20 is IERC20 {
    // ==================== External functions ====================

    function borrowBalanceCurrent(address account) external returns (uint256);

    function borrowBalanceStored(address account) external view returns (uint256);

    /**
     * @dev Calculates the exchange rate from the underlying to the CToken
     * @notice Accrue interest then return the up-to-date exchange rate
     *
     * @return uint256    Calculated exchange rate scaled by 1e18
     */
    function exchangeRateCurrent() external returns (uint256);

    function exchangeRateStored() external view returns (uint256);

    function underlying() external returns (address);

    /**
     * @dev Sender supplies assets into the market and receives cTokens in exchange
     * @notice Accrues interest whether or not the operation succeeds, unless reverted
     *
     * @param mintAmount    The amount of the underlying asset to supply
     *
     * @return uint256      0=success, otherwise a failure
     */
    function mint(uint256 mintAmount) external returns (uint256);

    /**
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @notice Sender redeems cTokens in exchange for the underlying asset
     *
     * @param redeemTokens    The number of cTokens to redeem into underlying
     *
     * @return uint256        0=success, otherwise a failure
     */
    function redeem(uint256 redeemTokens) external returns (uint256);

    /**
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @notice Sender redeems cTokens in exchange for a specified amount of underlying asset
     *
     * @param redeemAmount    The amount of underlying to redeem
     *
     * @return uint256        0=success, otherwise a failure
     */
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /**
     * @notice Sender borrows assets from the protocol to their own address
     *
     * @param borrowAmount    The amount of the underlying asset to borrow
     *
     * @return uint256        0=success, otherwise a failure
     */
    function borrow(uint256 borrowAmount) external returns (uint256);

    /**
     * @notice Sender repays their own borrow
     *
     * @param repayAmount    The amount to repay
     *
     * @return uint256       0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function repayBorrow(uint256 repayAmount) external returns (uint256);
}
