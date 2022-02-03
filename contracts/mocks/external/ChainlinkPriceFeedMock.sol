// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title ChainlinkPriceFeedMock
 * @author Matrix
 */
contract ChainlinkPriceFeedMock {
    // ==================== Variables ====================

    uint8 public _decimals;
    int256 public _price;

    // ==================== Constructor function ====================

    constructor(int256 price, uint8 decimals_) {
        _price = price;
        _decimals = decimals_;
    }

    // ==================== External functions ====================

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (0, _price * int256(10**_decimals), 0, 0, 0);
    }
}
