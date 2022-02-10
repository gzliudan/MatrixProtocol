// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { KyberV1ExchangeAdapterBase } from "./lib/KyberV1ExchangeAdapterBase.sol";

/**
 * @title KyberV1TransferFeeExchangeAdapter
 * @author Matrix
 *
 * @dev Uniswap V2 Exchange adapter that supports trading tokens with transfer fees
 */
contract KyberV1TransferFeeExchangeAdapter is KyberV1ExchangeAdapterBase {
    // ==================== Constructor function ====================

    constructor(address router) KyberV1ExchangeAdapterBase(router) {}

    // ==================== External functions ====================

    /**
     * @dev Return calldata for KyberSwap V1 DMMRouter02 when trading a token with a transfer fee
     *
     * @param srcToken           Address of source token to be sold
     * @param destToken          Address of destination token to buy
     * @param to                 Address that assets should be transferred to
     * @param srcQuantity        Amount of source token to sell
     * @param minDestQuantity    Min amount of destination token to buy
     * @param data               Bytes containing trade call data
     *
     * @return target            Target contract address
     * @return value             Call value
     * @return callData          Trade calldata
     */
    function getTradeCalldata(
        address srcToken,
        address destToken,
        address to,
        uint256 srcQuantity,
        uint256 minDestQuantity,
        bytes memory data
    )
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        require(srcToken != address(0), "KFEA0a");
        require(destToken != address(0), "KFEA0b");
        require(to != address(0), "KFEA0c");

        address[] memory path;

        if (data.length == 0) {
            path = new address[](2);
            path[0] = srcToken;
            path[1] = destToken;
        } else {
            path = abi.decode(data, (address[]));
            require(path.length >= 2, "KFEA0d");
        }

        address[] memory poolsPath = new address[](path.length - 1);
        for (uint256 i = 0; i < poolsPath.length; i++) {
            poolsPath[i] = _getBestPool(path[i], path[i + 1]);
        }

        value = 0;
        target = _router;

        // swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] memory poolsPath, IERC20[] memory path, address to, uint256 deadline)
        callData = abi.encodeWithSignature(
            "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address[],address,uint256)",
            srcQuantity, // amountIn
            minDestQuantity, // amountOutMin
            poolsPath, // poolsPath
            path, // path
            to, // to
            block.timestamp // deadline
        );
    }
}
