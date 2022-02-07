// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { IExchangeAdapter } from "../../../interfaces/IExchangeAdapter.sol";
import { IKyberNetworkProxy } from "../../../interfaces/external/kyber/IKyberNetworkProxy.sol";

/**
 * @title KyberLegacyExchangeAdapter
 * @author Matrix
 *
 * @dev Exchange adapter for Kyber that returns data for trades
 */
contract KyberLegacyExchangeAdapter {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;

    // ==================== Structs ====================

    struct KyberTradeInfo {
        uint256 sourceTokenDecimals; // Decimals of the token to send
        uint256 destinationTokenDecimals; // Decimals of the token to receive
        uint256 conversionRate; // Derived conversion rate from min receive quantity
    }

    // ==================== Variables ====================

    address public _kyberNetworkProxyAddress; // Address of Kyber Network Proxy

    // ==================== Constructor function ====================

    constructor(address kyberNetworkProxyAddress) {
        _kyberNetworkProxyAddress = kyberNetworkProxyAddress;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Calculate Kyber trade encoded calldata. To be invoked on the MatrixToken.
     *
     * @param  srcToken           Address of source token to be sold
     * @param  destToken          Address of destination token to buy
     * @param  to                 Address to receive traded tokens
     * @param  srcQuantity        Amount of source token to sell
     * @param  minDestQuantity    Min amount of destination token to buy
     *
     * @return target             Target address
     * @return value              Call value
     * @return callData           Trade calldata
     */
    function getTradeCalldata(
        address srcToken,
        address destToken,
        address to,
        uint256 srcQuantity,
        uint256 minDestQuantity,
        bytes calldata /* _data */
    )
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        require(srcToken != address(0), "KLEA0a");
        require(destToken != address(0), "KLEA0b");
        require(to != address(0), "KLEA0c");

        KyberTradeInfo memory kyberTradeInfo;

        kyberTradeInfo.sourceTokenDecimals = ERC20(srcToken).decimals();
        kyberTradeInfo.destinationTokenDecimals = ERC20(destToken).decimals();

        // Get conversion rate from minimum receive token quantity.
        // dstQty * (10 ** 18) * (10 ** dstDecimals) / (10 ** srcDecimals) / srcQty
        kyberTradeInfo.conversionRate = minDestQuantity
            .mul(PreciseUnitMath.preciseUnit())
            .mul(10**kyberTradeInfo.sourceTokenDecimals)
            .div(10**kyberTradeInfo.destinationTokenDecimals)
            .div(srcQuantity);

        value = 0;
        target = _kyberNetworkProxyAddress;

        // trade(IERC20 src, uint256 srcAmount, IERC20 dest, address payable destAddress, uint256 maxDestAmount, uint256 minConversionRate, address payable platformWallet)
        callData = abi.encodeWithSignature(
            "trade(address,uint256,address,address,uint256,uint256,address)",
            srcToken, // src
            srcQuantity, // srcAmount
            destToken, // dest
            to, // destAddress
            PreciseUnitMath.maxUint256(), // maxDestAmount, sell entire amount of srcToken
            kyberTradeInfo.conversionRate, // minConversionRate, trade with implied conversion rate
            address(0) // platformWallet, no referrer address
        );
    }

    /**
     * @dev Returns the Kyber Network Proxy address to approve source tokens for trading.
     */
    function getSpender() external view returns (address) {
        return _kyberNetworkProxyAddress;
    }

    /**
     * @dev Returns the conversion rate between the source token and the destination token in 18 decimals, regardless of component token's decimals
     *
     * @param  srcToken       Address of source token to be sold
     * @param  destToken      Address of destination token to buy
     * @param  srcQuantity    Amount of source token to sell
     *
     * @return uint256        Conversion rate in wei
     * @return uint256        Slippage rate in wei
     */
    function getConversionRates(
        address srcToken,
        address destToken,
        uint256 srcQuantity
    ) external view returns (uint256, uint256) {
        return IKyberNetworkProxy(_kyberNetworkProxyAddress).getExpectedRate(srcToken, destToken, srcQuantity);
    }
}
