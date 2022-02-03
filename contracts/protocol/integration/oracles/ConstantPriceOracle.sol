// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IOracle } from "../../../interfaces/IOracle.sol";

/**
 * @title ConstantPriceOracle
 */
contract ConstantPriceOracle is IOracle {
    // ==================== Variables ====================

    uint256 internal immutable _price;

    // ==================== Constructor function ====================

    constructor(uint256 price) {
        _price = price;
    }

    // ==================== External functions ====================

    function read() external view returns (uint256) {
        return _price;
    }
}
