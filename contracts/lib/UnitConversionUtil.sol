// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title UnitConversionUtil
 *
 * @dev Utility functions to convert PRECISE_UNIT values to and from other decimal units.
 */
library UnitConversionUtil {
    // ==================== Internal functions ====================

    /**
     * @dev Converts a uint256 PRECISE_UNIT quote quantity into an alternative decimal format.
     * This method is borrowed from PerpProtocol's `lushan` repo in lib/SettlementTokenMath
     *
     * @param amount      PRECISE_UNIT amount to convert from
     * @param decimals    Decimal precision format to convert to
     *
     * @return uint256    Input converted to alternative decimal precision format
     */
    function fromPreciseUnitToDecimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        return amount / (10**(18 - uint256(decimals)));
    }

    /**
     * @dev Converts an int256 PRECISE_UNIT quote quantity into an alternative decimal format.
     * This method is borrowed from PerpProtocol's `lushan` repo in lib/SettlementTokenMath
     *
     * @param amount      PRECISE_UNIT amount to convert from
     * @param decimals    Decimal precision format to convert to
     *
     * @return int256     Input converted to alternative decimal precision format
     */
    function fromPreciseUnitToDecimals(int256 amount, uint8 decimals) internal pure returns (int256) {
        return amount / int256(10**(18 - uint256(decimals)));
    }

    /**
     * @dev Converts an arbitrarily decimalized quantity into a int256 PRECISE_UNIT quantity.
     *
     * @param amount      Non-PRECISE_UNIT amount to convert
     * @param decimals    Decimal precision of amount being converted to PRECISE_UNIT
     *
     * @return int256     Input converted to int256 PRECISE_UNIT decimal format
     */
    function toPreciseUnitsFromDecimals(int256 amount, uint8 decimals) internal pure returns (int256) {
        return amount * int256(10**(18 - uint256(decimals)));
    }

    /**
     * @dev Converts an arbitrarily decimalized quantity into a uint256 PRECISE_UNIT quantity.
     *
     * @param amount      Non-PRECISE_UNIT amount to convert
     * @param decimals    Decimal precision of amount being converted to PRECISE_UNIT
     *
     * @return uint256    Input converted to uint256 PRECISE_UNIT decimal format
     */
    function toPreciseUnitsFromDecimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        return amount * (10**(18 - (uint256(decimals))));
    }
}
