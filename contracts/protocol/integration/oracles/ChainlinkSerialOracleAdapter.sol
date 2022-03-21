// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { FeedRegistryInterface } from "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";

// ==================== Internal Imports ====================

import { IOracleAdapter } from "../../../interfaces/IOracleAdapter.sol";

/**
 * @title ChainlinkSerialOracleAdapter
 * @author Matrix
 */
contract ChainlinkSerialOracleAdapter is IOracleAdapter {
    using SafeCast for int256;

    // ==================== Variables ====================

    FeedRegistryInterface internal immutable _registry;
    address internal immutable _intermediaryAsset;

    // ==================== Constructor function ====================

    constructor(address registry, address intermediaryAsset) {
        require(registry != address(0), "CSOA0a");
        require(intermediaryAsset != address(0), "CSOA0b");

        _registry = FeedRegistryInterface(registry);
        _intermediaryAsset = intermediaryAsset;
    }

    // ==================== External functions ====================

    function getFeedRegistry() external view returns (FeedRegistryInterface) {
        return _registry;
    }

    function getIntermediaryAsset() external view returns (address) {
        return _intermediaryAsset;
    }

    /// @dev Returns the latest price, multiplied by 1e18
    function getPrice(address base, address quote) external view returns (bool found, uint256 price) {
        address intermediaryAsset = _intermediaryAsset; // for save gas
        try _registry.decimals(base, intermediaryAsset) returns (uint8 decimals1) {
            try _registry.decimals(intermediaryAsset, quote) returns (uint8 decimals2) {
                (, int256 answer1, , , ) = _registry.latestRoundData(base, intermediaryAsset); // base * decimals1 / middleAsset
                (, int256 answer2, , , ) = _registry.latestRoundData(intermediaryAsset, quote); // middleAsset * decimals2 / quote

                found = true;
                price = answer1.toUint256() * answer2.toUint256(); // base * decimals1 * decimals2 / quote

                uint8 decimals = decimals1 + decimals2;
                if (decimals > 18) {
                    price /= 10**(decimals - 18);
                } else if (decimals < 18) {
                    price *= 10**(18 - decimals);
                }
            } catch {}
        } catch {}
    }
}
