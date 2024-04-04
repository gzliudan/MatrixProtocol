// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

// ==================== Internal Imports ====================

import { IOracle } from "../../../interfaces/IOracle.sol";

/**
 * @title ChainlinkSerialOracle
 * @author Matrix
 */
contract ChainlinkSerialOracle is IOracle {
    using SafeCast for int256;

    // ==================== Variables ====================

    string internal _name;
    int256 internal _ratio;

    AggregatorV3Interface internal immutable _priceFeed1;
    AggregatorV3Interface internal immutable _priceFeed2;

    // ==================== Constructor function ====================

    constructor(
        string memory name,
        AggregatorV3Interface priceFeed1,
        AggregatorV3Interface priceFeed2
    ) {
        _name = name;
        _priceFeed1 = priceFeed1;
        _priceFeed2 = priceFeed2;

        uint8 decimals = priceFeed1.decimals() + priceFeed2.decimals();

        if (decimals > 18) {
            _ratio = int256(10)**(decimals - 18);
        } else if (decimals < 18) {
            _ratio = -(int256(10)**(18 - decimals));
        }
    }

    // ==================== External functions ====================

    function getName() external view returns (string memory) {
        return _name;
    }

    function getRatio() external view returns (int256) {
        return _ratio;
    }

    function getPriceFeed1() external view returns (AggregatorV3Interface) {
        return _priceFeed1;
    }

    function getPriceFeed2() external view returns (AggregatorV3Interface) {
        return _priceFeed2;
    }

    /// @dev Returns the latest price, multiplied by 1e18
    function read() external view returns (uint256 price) {
        (, int256 price1, , , ) = _priceFeed1.latestRoundData(); // base * decimals1 / middle
        (, int256 price2, , , ) = _priceFeed2.latestRoundData(); // middle * decimals2 / quote

        price = price1.toUint256() * price2.toUint256(); // base * decimals1 * decimals2 / quote

        int256 ratio = _ratio; // for save gas
        if (ratio > 0) {
            price /= ratio.toUint256();
        } else if (ratio < 0) {
            price *= (-ratio).toUint256();
        }
    }
}
