// SPDX-License-Identifier: MIT

// Copy from https://github.com/KyberNetwork/dmm-smart-contracts/blob/master/contracts/libraries/MathExt.sol under terms of MIT with slight modifications

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

library MathExt {
    using SafeMath for uint256;

    uint256 public constant PRECISION = (10**18);

    /// @dev Returns x*y in precision
    function mulInPrecision(uint256 x, uint256 y) internal pure returns (uint256) {
        return x.mul(y) / PRECISION;
    }

    /// @dev source: dsMath
    /// @param xInPrecision should be < PRECISION, so this can not overflow
    /// @return zInPrecision = (x/PRECISION) ^k * PRECISION
    function unsafePowInPrecision(uint256 xInPrecision, uint256 k)
        internal
        pure
        returns (uint256 zInPrecision)
    {
        require(xInPrecision <= PRECISION, "MathExt: x > PRECISION");
        zInPrecision = k % 2 != 0 ? xInPrecision : PRECISION;

        for (k /= 2; k != 0; k /= 2) {
            xInPrecision = (xInPrecision * xInPrecision) / PRECISION;

            if (k % 2 != 0) {
                zInPrecision = (zInPrecision * xInPrecision) / PRECISION;
            }
        }
    }

    // babylonian method (https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method)
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
