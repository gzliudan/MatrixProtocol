// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { Erc20WithFeeMock } from "../Erc20WithFeeMock.sol";
import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";

/**
 * @title ExactSafeErc20Mock
 */
contract ExactSafeErc20Mock {
    using ExactSafeErc20 for IERC20;

    // ==================== Variables ====================

    IERC20 public _erc20;

    // ==================== External functions ====================

    function setErc20(address erc20) external {
        _erc20 = IERC20(erc20);
    }

    function testExactSafeTransfer(address to, uint256 amount) external {
        _erc20.exactSafeTransfer(to, amount);
    }

    function testExactSafeTransferFrom(
        address from,
        address to,
        uint256 amount
    ) external {
        _erc20.exactSafeTransferFrom(from, to, amount);
    }
}
