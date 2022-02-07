// SPDX-License-Identifier: MIT

// Copy from https://github.com/KyberNetwork/smart-contracts/blob/master/contracts/sol6/IKyberNetworkProxy.sol under terms of MIT License with slight modifications

pragma solidity ^0.8.0;

/**
 * @title IKyberNetworkProxy
 */
interface IKyberNetworkProxy {
    function getExpectedRate(
        address src,
        address dest,
        uint256 srcQty
    )
        external
        view
        returns (uint256, uint256);

    function trade(
        address src,
        uint256 srcAmount,
        address dest,
        address destAddress,
        uint256 maxDestAmount,
        uint256 minConversionRate,
        address referalFeeAddress
    )
        external
        payable
        returns (uint256);
}
