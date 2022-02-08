// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { KyberV1ExchangeAdapterBase } from "./lib/KyberV1ExchangeAdapterBase.sol";

/**
 * @title KyberV1ExchangeAdapter
 * @author Matrix
 *
 * @dev KyberSwap V1 exchange adapter which encodes trade data
 */
contract KyberV1ExchangeAdapter is KyberV1ExchangeAdapterBase {
    // ==================== Constructor function ====================

    constructor(address router) KyberV1ExchangeAdapterBase(router) {}

    // ==================== External functions ====================

    /**
     * @dev Return calldata for KyberSwap V1 DMMRouter02
     *
     * @param srcToken           Address of source token to be sold
     * @param destToken          Address of destination token to buy
     * @param to                 Address that assets should be transferred to
     * @param srcQuantity        Amount of source token to sell
     * @param minDestQuantity    Min amount of destination token to buy
     * @param data               Bytes containing trade path data
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
        require(srcToken != address(0), "KEA0a");
        require(destToken != address(0), "KEA0b");
        require(to != address(0), "KEA0c");

        address[] memory path;

        if (data.length == 0) {
            path = new address[](2);
            path[0] = srcToken;
            path[1] = destToken;
        } else {
            path = abi.decode(data, (address[]));
            require(path.length >= 2, "KEA0d");
        }

        address[] memory poolsPath = new address[](path.length - 1);
        for (uint256 i = 0; i < poolsPath.length; i++) {
            poolsPath[i] = _getBestPool(path[i], path[i + 1]);
        }

        value = 0;
        target = _router;

        // swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] memory poolsPath, IERC20[] memory path, address to, uint256 deadline)
        callData = abi.encodeWithSignature(
            "swapExactTokensForTokens(uint256,uint256,address[],address[],address,uint256)",
            srcQuantity, // uint256 amountIn
            minDestQuantity, // uint256 amountOutMin
            poolsPath, // address[] memory poolsPath
            path, // IERC20[] memory path
            to, // address to
            block.timestamp // uint256 deadline
        );
    }
}
