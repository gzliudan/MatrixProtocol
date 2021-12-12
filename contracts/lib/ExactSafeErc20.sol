// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ExactSafeErc20
 *
 * @dev Utility functions for ERC20 transfers that require the explicit amount to be transferred.
 */
library ExactSafeErc20 {
    using SafeERC20 for IERC20;

    // ==================== Internal functions ====================

    /**
     * Ensures that the recipient has received the correct quantity (ie no fees taken on transfer)
     */
    function exactSafeTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) internal {
        if (amount > 0) {
            uint256 oldBalance = token.balanceOf(to);
            token.safeTransfer(to, amount);
            uint256 newBalance = token.balanceOf(to);
            require(newBalance == oldBalance + amount, "ES0"); // "Invalid post transfer balance"
        }
    }

    /**
     * Ensures that the recipient has received the correct quantity (ie no fees taken on transfer)
     */
    function exactSafeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (amount > 0) {
            uint256 oldBalance = token.balanceOf(to);
            token.safeTransferFrom(from, to, amount);

            if (from != to) {
                require(token.balanceOf(to) == oldBalance + amount, "ES1"); // "Invalid post transfer balance"
            }
        }
    }
}
