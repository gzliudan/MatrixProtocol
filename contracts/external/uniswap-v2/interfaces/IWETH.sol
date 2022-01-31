// SPDX-License-Identifier: GPL-3.0-only

// Copy from https://github.com/Uniswap/v2-periphery/blob/master/contracts/interfaces/IWETH.sol under terms of GPL-3.0

pragma solidity >=0.5.0;

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
}
