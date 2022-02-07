// SPDX-License-Identifier: BUSL-1.1

// Copy from https://github.com/KyberNetwork/dmm-smart-contracts/blob/master/contracts/interfaces/IDMMCallee.sol under terms of BUSL-1.1 with slight modifications

pragma solidity ^0.8.0;

interface IDMMCallee {
    function dmmSwapCall(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}
