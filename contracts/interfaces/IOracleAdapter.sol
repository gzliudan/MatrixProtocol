// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IOracleAdapter
 */
interface IOracleAdapter {
    // ==================== External functions ====================

    /**
     * @dev Function for retrieving a price that requires sourcing data from outside protocols to calculate.
     *
     * @param  asset1    Base asset in pair
     * @param  asset2    Quote asset in pair
     *
     * @return found     Boolean indicating if oracle exists
     * @return price     Current price of asset represented in uint256
     */
    function getPrice(address asset1, address asset2) external view returns (bool found, uint256 price);
}
