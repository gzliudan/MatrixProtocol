// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IOracle } from "../../interfaces/IOracle.sol";

/**
 * @title OracleMock
 */
contract OracleMock is IOracle {
    // ==================== Variables ====================

    uint256 public _price;

    // ==================== Constructor function ====================

    constructor(uint256 startingPrice) {
        _price = startingPrice;
    }

    // ==================== External functions ====================

    function updatePrice(uint256 newPrice) external {
        _price = newPrice;
    }

    /**
     * @dev Returns the queried data from an oracle returning uint256
     *
     * @return    Current price of asset represented in uint256
     */
    function read() external view returns (uint256) {
        return _price;
    }
}
