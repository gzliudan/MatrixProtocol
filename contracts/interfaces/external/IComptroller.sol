// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { ICErc20 } from "./ICErc20.sol";

/**
 * @title IComptroller
 *
 * @dev Interface for interacting with Compound Comptroller
 */
interface IComptroller {
    // ==================== External functions ====================

    /**
     * @notice Add assets to be included in account liquidity calculation
     *
     * @param cTokens    The list of addresses of the cToken markets to be enabled
     *
     * @return uint256[] Success indicator for whether each corresponding market was entered
     */
    function enterMarkets(address[] memory cTokens) external returns (uint256[] memory);

    /**
     * @dev Sender must not have an outstanding borrow balance in the asset, or be providing neccessary collateral for an outstanding borrow.
     * @notice Removes asset from sender's account liquidity calculation
     *
     * @param cTokenAddress    The address of the asset to be removed
     *
     * @return uint256         Whether or not the account successfully exited the market
     */
    function exitMarket(address cTokenAddress) external returns (uint256);

    function getAllMarkets() external view returns (ICErc20[] memory);

    function claimComp(address holder) external;

    function compAccrued(address holder) external view returns (uint256);

    function getCompAddress() external view returns (address);
}
