// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { ChainlinkPriceFeedMock } from "./ChainlinkPriceFeedMock.sol";

/**
 * @title ChainlinkFeedRegistryMock
 * @author Matrix
 */
contract ChainlinkFeedRegistryMock {
    // ==================== Variables ====================

    mapping(address => mapping(address => ChainlinkPriceFeedMock)) internal _priceFeeds;

    // ==================== External functions ====================

    function decimals(address base, address quote) external view returns (uint8) {
        ChainlinkPriceFeedMock priceFeed = _priceFeeds[base][quote];

        require(address(priceFeed) != address(0), "Feed not found");

        return priceFeed.decimals();
    }

    function latestRoundData(address base, address quote)
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
        ChainlinkPriceFeedMock priceFeed = _priceFeeds[base][quote];

        require(address(priceFeed) != address(0), "Feed not found");

        return priceFeed.latestRoundData();
    }

    function setFeed(
        address base,
        address quote,
        ChainlinkPriceFeedMock feed
    ) external {
        _priceFeeds[base][quote] = feed;
    }
}
