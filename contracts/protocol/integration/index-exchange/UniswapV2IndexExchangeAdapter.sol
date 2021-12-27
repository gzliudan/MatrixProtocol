// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IIndexExchangeAdapter } from "../../../interfaces/IIndexExchangeAdapter.sol";

import { BytesLib } from "../../../external/BytesLib.sol";

/**
 * @title UniswapV2IndexExchangeAdapter
 *
 * @dev A Uniswap Router02 exchange adapter that returns calldata for trading with GeneralIndexModule,
 * allows encoding a trade with a fixed input quantity or a fixed output quantity.
 */
contract UniswapV2IndexExchangeAdapter is IIndexExchangeAdapter {
    using BytesLib for bytes; // BytesLib.toAddress

    // ==================== Constants ====================

    // Uniswap router function string for swapping exact tokens for a minimum of receive tokens
    string internal constant SWAP_EXACT_TOKENS_FOR_TOKENS = "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)";

    // Uniswap router function string for swapping tokens for an exact amount of receive tokens
    string internal constant SWAP_TOKENS_FOR_EXACT_TOKENS = "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)";

    // ==================== Variables ====================

    // Address of Uniswap V2 Router02 contract
    address public immutable _router;

    // ==================== Constructor function ====================

    /**
     * @param router    Address of Uniswap V2 Router02 contract
     */
    constructor(address router) {
        _router = router;
    }

    // ==================== External functions ====================

    /**
     * @dev Return calldata for trading Uniswap V2 Router02. Trade paths are created from input and output tokens,
     * _isSendTokenFixed indicates whether a fixed amount of token should be sold or an unfixed amount.
     * @notice When _isSendTokenFixed is false, sourceQuantity is defined as the max token quantity you are willing to trade, and
     * destinationQuantity is the exact quantity of token you are receiving.
     *
     * @param sourceToken            Address of source token to be sold
     * @param destinationToken       Address of destination token to buy
     * @param destinationAddress     Address that assets should be transferred to
     * @param isSendTokenFixed       Boolean indicating if the send quantity is fixed, used to determine correct trade interface
     * @param sourceQuantity         Fixed/Max amount of source token to sell
     * @param destinationQuantity    Min/Fixed amount of destination token to buy
     * @param data                   Encoded address intermediary token in the trade path. If empty, path is the input and output tokens. Only allows one intermediary asset
     *
     * @return target                Target contract address
     * @return value                 Call value
     * @return callData              Trade calldata
     */
    function getTradeCalldata(
        address sourceToken,
        address destinationToken,
        address destinationAddress,
        bool isSendTokenFixed,
        uint256 sourceQuantity,
        uint256 destinationQuantity,
        bytes memory data
    )
        external
        view
        override
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        address[] memory path;

        if (data.length == 0) {
            path = new address[](2);
            path[0] = sourceToken;
            path[1] = destinationToken;
        } else {
            address intermediateToken = data.toAddress(0);
            path = new address[](3);
            path[0] = sourceToken;
            path[1] = intermediateToken;
            path[2] = destinationToken;
        }

        callData = isSendTokenFixed
            ? abi.encodeWithSignature(SWAP_EXACT_TOKENS_FOR_TOKENS, sourceQuantity, destinationQuantity, path, destinationAddress, block.timestamp)
            : abi.encodeWithSignature(SWAP_TOKENS_FOR_EXACT_TOKENS, destinationQuantity, sourceQuantity, path, destinationAddress, block.timestamp);

        target = _router;
        value = 0;
    }

    /**
     * @dev Returns the address to approve source tokens for trading. This is the Uniswap router address
     *
     * @return address    Address of the contract to approve tokens to
     */
    function getSpender() external view override returns (address) {
        return _router;
    }
}
