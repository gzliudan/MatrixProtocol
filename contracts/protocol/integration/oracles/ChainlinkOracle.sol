// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

// ==================== Internal Imports ====================

import { IOracle } from "../../../interfaces/IOracle.sol";

/**
 * @title ChainlinkOracle
 * @author Matrix
 */
contract ChainlinkOracle is IOracle {
    using SafeCast for int256;

    // ==================== Variables ====================

    string internal _name;
    AggregatorV3Interface internal immutable _priceFeed;
    uint256 internal immutable _ratio;

    // ==================== Constructor function ====================

    constructor(string memory name, AggregatorV3Interface priceFeed) {
        _name = name;
        _priceFeed = priceFeed;
        _ratio = 10**(18 - priceFeed.decimals()); // assume 0 <= decimals <= 18
    }

    // ==================== External functions ====================

    function getName() external view returns (string memory) {
        return _name;
    }

    function getPriceFeed() external view returns (address) {
        return address(_priceFeed);
    }

    /// @dev Returns the latest price, multiplied by 1e18
    function read() external view returns (uint256) {
        (, int256 price, , , ) = _priceFeed.latestRoundData();
        uint256 result = price.toUint256();

        return (_ratio == 1) ? result : (result * _ratio);
    }
}
