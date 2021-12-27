// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { BytesLib } from "../../../external/BytesLib.sol";

import { ISwapRouter } from "../../../interfaces/external/uniswap-v3/ISwapRouter.sol";

/**
 * @title UniswapV3ExchangeAdapter
 *
 * Exchange adapter for Uniswap V3 SwapRouter that encodes trade data
 */
contract UniswapV3ExchangeAdapter {
    using BytesLib for bytes; // for function BytesLib.toAddress

    // ==================== Constants ====================

    // signature of exactInput SwapRouter function
    string internal constant EXACT_INPUT = "exactInput((bytes,address,uint256,uint256,uint256))";

    // ==================== Variables ====================

    // Address of Uniswap V3 SwapRouter contract
    address public immutable _swapRouter;

    // ==================== Constructor function ====================

    /**
     * @param swapRouter    Address of Uniswap V3 SwapRouter
     */
    constructor(address swapRouter) {
        _swapRouter = swapRouter;
    }

    // ==================== External functions ====================

    /**
     * @dev Return calldata for Uniswap V3 SwapRouter
     *
     * @param srcToken               Address of source token to be sold
     * @param destToken          Address of destination token to buy
     * @param to        Address that assets should be transferred to
     * @param srcQuantity            Amount of source token to sell
     * @param minDestQuantity    Min amount of destination token to buy
     * @param data                      Uniswap V3 path. Equals the output of the generateDataParam function
     *
     * @return target                   Target contract address
     * @return value                    Call value
     * @return callData                 Trade calldata
     */
    function getTradeCalldata(
        address srcToken,
        address destToken,
        address to,
        uint256 srcQuantity,
        uint256 minDestQuantity,
        bytes calldata data
    )
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        address sourceFromPath = data.toAddress(0);
        require(srcToken == sourceFromPath, "UcEA0a"); // "UniswapV3ExchangeAdapter: source token path mismatch"

        address destinationFromPath = data.toAddress(data.length - 20);
        require(destToken == destinationFromPath, "UcEA0b"); // "UniswapV3ExchangeAdapter: destination token path mismatch"

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams(data, to, block.timestamp, srcQuantity, minDestQuantity);

        value = 0;
        target = _swapRouter;
        callData = abi.encodeWithSignature(EXACT_INPUT, params);
    }

    /**
     * @dev Returns the address to approve source tokens for trading. This is the Uniswap SwapRouter address
     *
     * @return address    Address of the contract to approve tokens to
     */
    function getSpender() external view returns (address) {
        return _swapRouter;
    }

    /**
     * @dev Returns the appropriate data argument for getTradeCalldata. Equal to the encodePacked path with the
     * fee of each hop between it, e.g [token1, fee1, token2, fee2, token3]. Note: fees.length == path.length - 1
     *
     * @param path    array of addresses to use as the path for the trade
     * @param fees    array of uint24 representing the pool fee to use for each hop
     */
    function generateDataParam(address[] calldata path, uint24[] calldata fees) external pure returns (bytes memory data) {
        require(path.length == fees.length + 1, "UcEA1");

        for (uint256 i = 0; i < fees.length; i++) {
            data = abi.encodePacked(data, path[i], fees[i]);
        }

        // last encode has no fee associated with it since fees.length == path.length - 1
        data = abi.encodePacked(data, path[fees.length]);
    }
}
