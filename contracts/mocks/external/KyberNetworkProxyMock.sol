// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title KyberNetworkProxyMock
 */
contract KyberNetworkProxyMock {
    using SafeMath for uint256;

    // ==================== Structs ====================

    struct Token {
        bool exists;
        uint256 rate;
        uint256 decimals;
    }

    // ==================== Variables ====================

    address internal _owner;
    address internal _mockWethAddress;
    mapping(address => Token) internal _tokens;

    // ==================== Constructor function ====================

    constructor(address mockWethAddress) {
        _mockWethAddress = mockWethAddress;
        _owner = msg.sender;
    }

    // ==================== External functions ====================

    /**
     * Adds a tradable token to the Kyber instance
     *
     * @param token        The token to add
     * @param rate         The rate for the token as 1 TOKN = (rate/10**18) ETH
     * @param decimals     The number of decimals for the token
     */
    function addToken(
        ERC20 token,
        uint256 rate,
        uint256 decimals
    ) public {
        require(msg.sender == _owner, "KyberNetwork: unauthorized");
        _tokens[address(token)] = Token({ exists: true, rate: rate, decimals: decimals });
    }

    function getExpectedRate(
        address src,
        address dest,
        uint256 srcQty
    ) public view returns (uint256 expectedRate, uint256 slippageRate) {
        srcQty; // Used to silence compiler warnings

        if (src == _mockWethAddress) {
            expectedRate = 10**36 / _tokens[dest].rate;
            slippageRate = expectedRate;
        } else if (dest == _mockWethAddress) {
            expectedRate = _tokens[src].rate;
            slippageRate = expectedRate;
        } else {
            revert("KyberNetwork: Unknown token pair");
        }
    }

    function trade(
        ERC20 src,
        uint256 srcAmount,
        ERC20 dest,
        address destAddress,
        uint256 maxDestAmount,
        uint256, /* minConversionRate */
        address /* walletId */
    ) public payable returns (uint256 destAmount) {
        uint256 expectedRate;
        uint256 srcAmount_;

        if (address(src) == _mockWethAddress) {
            expectedRate = 10**36 / _tokens[address(dest)].rate;
            destAmount = expectedRate.mul(srcAmount).div(10**(36 - _tokens[address(dest)].decimals));

            if (destAmount > maxDestAmount) {
                destAmount = maxDestAmount;
                srcAmount_ = maxDestAmount.mul(10**(36 - _tokens[address(dest)].decimals)).div(expectedRate);
            } else {
                srcAmount_ = srcAmount;
            }

            require(src.transferFrom(msg.sender, address(this), srcAmount_), "KyberNetwork: not enough WETH provided");
            require(ERC20(dest).transfer(destAddress, destAmount), "KyberNetwork: ERC20 transfer failed");
        } else if (address(dest) == _mockWethAddress) {
            expectedRate = _tokens[address(src)].rate;
            destAmount = expectedRate.mul(srcAmount).div(10**_tokens[address(src)].decimals);

            if (destAmount > maxDestAmount) {
                destAmount = maxDestAmount;
                srcAmount_ = maxDestAmount.mul(10**_tokens[address(src)].decimals).div(expectedRate);
            } else {
                srcAmount_ = srcAmount;
            }

            require(src.transferFrom(msg.sender, address(this), srcAmount_), "KyberNetwork: not enough ERC20 provided");
            require(dest.transfer(destAddress, destAmount), "KyberNetwork: not enough WETH transferred back");
        } else {
            revert("KyberNetwork: Unknown token pair");
        }
    }
}
