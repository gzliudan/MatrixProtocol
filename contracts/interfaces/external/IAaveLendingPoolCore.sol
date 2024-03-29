// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

interface IAaveLendingPoolCore {
    function getReserveATokenAddress(address _reserve) external view returns (address);
}
