// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

/**
 * @title AddressArrayMock
 */
contract AddressArrayMock {
    // ==================== Variables ====================

    address[] public _testArray;

    // ==================== External functions ====================

    function getTestArray() external view returns (address[] memory) {
        return _testArray;
    }

    function setTestArray(address[] memory array) external {
        _testArray = array;
    }

    function hasDuplicate(address[] memory array) external pure returns (bool) {
        return AddressArrayUtil.hasDuplicate(array);
    }

    function hasDuplicateItem() external view returns (bool) {
        return AddressArrayUtil.hasDuplicate(_testArray);
    }

    function indexOf(address[] memory array, address value) external pure returns (uint256 index, bool found) {
        return AddressArrayUtil.indexOf(array, value);
    }

    function contain(address[] memory array, address value) external pure returns (bool) {
        return AddressArrayUtil.contain(array, value);
    }

    function removeValue(address[] memory array, address value) external pure returns (address[] memory) {
        return AddressArrayUtil.removeValue(array, value);
    }

    function removeItem(address item) external {
        AddressArrayUtil.removeItem(_testArray, item);
    }

    function quickRemoveItem(address item) external {
        AddressArrayUtil.quickRemoveItem(_testArray, item);
    }

    function merge(address[] memory array1, address[] memory array2) external pure returns (address[] memory) {
        return AddressArrayUtil.merge(array1, array2);
    }
}
