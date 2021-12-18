// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWETH
 *
 * @dev This interface allows for interaction for wrapped ether's deposit and withdrawal functionality.
 */
interface IWETH is IERC20 {
    // ==================== External functions ====================

    function deposit() external payable;

    function withdraw(uint256 wad) external;
}
