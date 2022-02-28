// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IOracle } from "../../../interfaces/IOracle.sol";

/**
 * @title SerialOracle
 * @author Matrix
 *
 * @dev SerialOracle returns price of asset1/asset3 from two oracles: oracle1(asset1/asset2), oracle2(asset2/asset3)
 */
contract SerialOracle is IOracle {
    // ==================== Variables ====================

    string internal _name;
    IOracle internal immutable _oracle1;
    IOracle internal immutable _oracle2;

    // ==================== Constructor function ====================

    constructor(
        string memory name,
        IOracle oracle1,
        IOracle oracle2
    ) {
        _name = name;
        _oracle1 = oracle1;
        _oracle2 = oracle2;
    }

    // ==================== External functions ====================

    function getName() external view returns (string memory) {
        return _name;
    }

    function getOracle1() external view returns (IOracle) {
        return _oracle1;
    }

    function getOracle2() external view returns (IOracle) {
        return _oracle2;
    }

    /// @dev Returns the latest price, multiplied by 1e18
    function read() external view returns (uint256 price) {
        uint256 price1 = _oracle1.read(); // asset1 * 1e18 / asset2
        uint256 price2 = _oracle2.read(); // asset2 * 1e18 / asset3
        price = (price1 * price2) / 1e18;
    }
}
