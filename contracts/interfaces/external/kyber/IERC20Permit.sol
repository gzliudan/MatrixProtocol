// SPDX-License-Identifier: MIT

// Copy from https://github.com/KyberNetwork/dmm-smart-contracts/blob/master/contracts/interfaces/IERC20Permit.sol under terms of MIT with slight modifications

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Permit is IERC20 {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
