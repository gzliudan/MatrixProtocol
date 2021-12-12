// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

contract PreciseUnitMathMock {
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;

    // ==================== External functions ====================

    function preciseUnit() external pure returns (uint256) {
        return PreciseUnitMath.preciseUnit();
    }

    function maxUint256() external pure returns (uint256) {
        return PreciseUnitMath.maxUint256();
    }

    function preciseMul(uint256 a, uint256 b) external pure returns (uint256) {
        return a.preciseMul(b);
    }

    function preciseMulCeil(uint256 a, uint256 b) external pure returns (uint256) {
        return a.preciseMulCeil(b);
    }

    function preciseDiv(uint256 a, uint256 b) external pure returns (uint256) {
        return a.preciseDiv(b);
    }

    function preciseDivCeil(uint256 a, uint256 b) external pure returns (uint256) {
        return a.preciseDivCeil(b);
    }

    function preciseUnitInt() external pure returns (int256) {
        return PreciseUnitMath.preciseUnitInt();
    }

    function maxInt256() external pure returns (int256) {
        return PreciseUnitMath.maxInt256();
    }

    function minInt256() external pure returns (int256) {
        return PreciseUnitMath.minInt256();
    }

    function preciseMulInt(int256 a, int256 b) external pure returns (int256) {
        return a.preciseMul(b);
    }

    function preciseDivInt(int256 a, int256 b) external pure returns (int256) {
        return a.preciseDiv(b);
    }

    function preciseDivCeilInt(int256 a, int256 b) external pure returns (int256) {
        return a.preciseDivCeil(b);
    }

    function preciseMulFloorInt(int256 a, int256 b) external pure returns (int256) {
        return a.preciseMulFloor(b);
    }

    function preciseDivFloorInt(int256 a, int256 b) external pure returns (int256) {
        return a.preciseDivFloor(b);
    }

    function approximatelyEquals(
        uint256 a,
        uint256 b,
        uint256 range
    ) external pure returns (bool) {
        return a.approximatelyEquals(b, range);
    }
}
