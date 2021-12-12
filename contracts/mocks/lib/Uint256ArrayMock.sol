// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { Uint256ArrayUtil } from "../../lib/Uint256ArrayUtil.sol";

/**
 * @title Uint256ArrayMock
 */
contract Uint256ArrayMock {
    // ==================== External functions ====================

    function merge(uint256[] memory array1, uint256[] memory array2) public pure returns (uint256[] memory) {
        return Uint256ArrayUtil.merge(array1, array2);
    }
}
