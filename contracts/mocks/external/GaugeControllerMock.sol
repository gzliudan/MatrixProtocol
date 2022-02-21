// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title GaugeControllerMock
 *
 * @dev Mocks similar behaviour of the Curve GaugeController contract.
 */
contract GaugeControllerMock {
    mapping(address => int128) internal _types;

    function addGaugeType(address gauge, int128 gaugeType) external {
        _types[gauge] = gaugeType + 1;
    }

    function gauge_types(address gauge) external view returns (int128) {
        int128 gaugeType = _types[gauge];

        require(gaugeType != 0, "Not valid");

        return gaugeType - 1;
    }
}
