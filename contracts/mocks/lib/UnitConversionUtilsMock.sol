// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import { UnitConversionUtil } from "../../lib/UnitConversionUtil.sol";

contract UnitConversionUtilMock {
    using UnitConversionUtil for int256;
    using UnitConversionUtil for uint256;

    // ==================== External functions ====================

    function fromPreciseUnitToDecimalsUint(uint256 amount, uint8 decimals) public pure returns (uint256) {
        return amount.fromPreciseUnitToDecimals(decimals);
    }

    function fromPreciseUnitToDecimalsInt(int256 amount, uint8 decimals) public pure returns (int256) {
        return amount.fromPreciseUnitToDecimals(decimals);
    }

    function toPreciseUnitsFromDecimals(int256 amount, uint8 decimals) public pure returns (int256) {
        return amount.toPreciseUnitsFromDecimals(decimals);
    }
}
