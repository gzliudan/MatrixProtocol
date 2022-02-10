// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { KyberV1ExchangeAdapterBase } from "./lib/KyberV1ExchangeAdapterBase.sol";

/**
 * @title KyberV1ExchangeAdapterV2
 * @author Matrix
 *
 * @dev KyberSwap V1 exchange adapter that returns calldata for trading includes option for 2 different trade types.
 */
contract KyberV1ExchangeAdapterV2 is KyberV1ExchangeAdapterBase {
    // ==================== Constants ====================

    // DMMRouter02 function string for swapping exact tokens for a minimum of receive tokens
    // uint256 amountIn, uint256 amountOutMin, address[] memory poolsPath, IERC20[] memory path, address to, uint256 deadline
    string public constant SWAP_EXACT_TOKENS_FOR_TOKENS = "swapExactTokensForTokens(uint256,uint256,address[],address[],address,uint256)";

    // DMMRouter02 function string for swapping tokens for an exact amount of receive tokens
    // uint256 amountOut, uint256 amountInMax, address[] memory poolsPath, IERC20[] memory path, address to, uint256 deadline
    string public constant SWAP_TOKENS_FOR_EXACT_TOKENS = "swapTokensForExactTokens(uint256,uint256,address[],address[],address,uint256)";

    // ==================== Constructor function ====================

    constructor(address router) KyberV1ExchangeAdapterBase(router) {}

    // ==================== External functions ====================

    /**
     * @dev Return calldata for KyberSwap V1 DMMRouter02. Trade paths and bool to select trade function are encoded in the arbitrary data parameter.
     *
     * @notice When selecting the swap for exact tokens function:
     * srcQuantity is defined as the max token quantity you are willing to trade,
     * minDestinationQuantity is the exact quantity of token you are receiving.
     *
     * @param to              Address that assets should be transferred to
     * @param srcQuantity     Fixed/Max amount of source token to sell
     * @param destQuantity    Min/Fixed amount of destination token to buy
     * @param data            Bytes containing trade path and bool to determine function string
     *
     * @return target         Target contract address
     * @return value          Call value
     * @return callData       Trade calldata
     */
    function getTradeCalldata(
        address srcToken,
        address destToken,
        address to,
        uint256 srcQuantity,
        uint256 destQuantity,
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
        require(srcToken != address(0), "KEAb0a");
        require(destToken != address(0), "KEAb0b");
        require(to != address(0), "KEAb0c");

        (address[] memory path, bool shouldSwapExactTokensForTokens) = abi.decode(data, (address[], bool));
        require(path.length >= 2, "KEAbd");

        address[] memory poolsPath = new address[](path.length - 1);
        for (uint256 i = 0; i < poolsPath.length; i++) {
            poolsPath[i] = _getBestPool(path[i], path[i + 1]);
        }

        value = 0;
        target = _router;
        callData = shouldSwapExactTokensForTokens
            ? abi.encodeWithSignature(SWAP_EXACT_TOKENS_FOR_TOKENS, srcQuantity, destQuantity, poolsPath, path, to, block.timestamp)
            : abi.encodeWithSignature(SWAP_TOKENS_FOR_EXACT_TOKENS, destQuantity, srcQuantity, poolsPath, path, to, block.timestamp);
    }

    /**
     * @dev Generate data parameter to be passed to `getTradeCalldata`. Returns encoded trade paths and bool to select trade function.
     *
     * @param srcToken     Address of the source token to be sold
     * @param destToken    Address of the destination token to buy
     * @param fixIn        Boolean representing if input tokens amount is fixed
     *
     * @return bytes       Data parameter to be passed to `getTradeCalldata`
     */
    function createDataParam(
        address srcToken,
        address destToken,
        bool fixIn
    ) external pure returns (bytes memory) {
        address[] memory path = new address[](2);
        path[0] = srcToken;
        path[1] = destToken;

        return abi.encode(path, fixIn);
    }

    function createDataParam2(
        address srcToken,
        address midToken,
        address destToken,
        bool fixIn
    ) external pure returns (bytes memory) {
        address[] memory path = new address[](3);
        path[0] = srcToken;
        path[1] = midToken;
        path[2] = destToken;

        return abi.encode(path, fixIn);
    }

    /**
     * @dev Helper that returns the encoded data of trade path and boolean indicating the KyberV1 function to use
     *
     * @return bytes    Encoded data used for trading on KyberV1
     */
    function getExchangeData(address[] memory path, bool shouldSwapExactTokensForTokens) external pure returns (bytes memory) {
        return abi.encode(path, shouldSwapExactTokensForTokens);
    }
}
