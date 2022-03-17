// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { FeedRegistryInterface } from "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";

// ==================== Internal Imports ====================

import { IOracleAdapter } from "../../../interfaces/IOracleAdapter.sol";

/**
 * @title ChainlinkOracleAdapter
 * @author Matrix
 */
contract ChainlinkOracleAdapter is IOracleAdapter {
    using SafeCast for int256;

    // ==================== Variables ====================

    FeedRegistryInterface internal immutable _registry;

    // ==================== Constructor function ====================

    constructor(address registry) {
        require(registry != address(0), "COA0");

        _registry = FeedRegistryInterface(registry);
    }

    // ==================== External functions ====================

    function getFeedRegistry() external view returns (FeedRegistryInterface) {
        return _registry;
    }

    function getPrice(address base, address quote) external view returns (bool found, uint256 price) {
        try _registry.decimals(base, quote) returns (uint8 decimals) {
            (, int256 answer, , , ) = _registry.latestRoundData(base, quote);

            found = true;
            price = (decimals == 18) ? answer.toUint256() : (answer.toUint256() * (10**(18 - decimals)));
        } catch {}
    }
}
