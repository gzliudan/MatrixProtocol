// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title Uint256ArrayUtil
 *
 * @dev Utility functions to handle Uint256 Arrays
 */
library Uint256ArrayUtil {
    // ==================== Internal functions ====================

    /**
     * @dev Combine two arrays.
     *
     * @param array1     The first input array.
     * @param array2     The second input array.
     *
     * @return result    The new array which is array1 + array2
     */
    function merge(uint256[] memory array1, uint256[] memory array2) internal pure returns (uint256[] memory result) {
        result = new uint256[](array1.length + array2.length);

        uint256 i = 0;
        while (i < array1.length) {
            result[i] = array1[i];
            i++;
        }

        for (uint256 j = 0; j < array2.length; j++) {
            result[i++] = array2[j];
        }
    }
}
