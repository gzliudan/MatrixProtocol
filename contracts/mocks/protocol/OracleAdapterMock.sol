// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IOracleAdapter } from "../../interfaces/IOracleAdapter.sol";

/**
 * @title OracleAdapterMock
 */
contract OracleAdapterMock is IOracleAdapter {
    // ==================== Variables ====================

    uint256 public _dummyPrice;
    address public _asset;

    // ==================== Constructor function ====================

    constructor(address asset, uint256 dummyPrice) {
        _dummyPrice = dummyPrice;
        _asset = asset;
    }

    // ==================== External functions ====================

    function getPrice(
        address asset1,
        address /* asset2 */
    ) external view returns (bool found, uint256 price) {
        return (asset1 == _asset) ? (true, _dummyPrice) : (false, 0);
    }
}
