// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { BytesLib } from "../../../external/BytesLib.sol";

import { ISwapRouter } from "../../../interfaces/external/uniswap-v3/ISwapRouter.sol";

import { IIndexExchangeAdapter } from "../../../interfaces/IIndexExchangeAdapter.sol";

/**
 * @title UniswapV3IndexExchangeAdapter
 *
 * A Uniswap V3 exchange adapter that returns calldata for trading with GeneralIndexModule,
 * allows encoding a trade with a fixed input quantity or a fixed output quantity.
 */
contract UniswapV3IndexExchangeAdapter is IIndexExchangeAdapter {
    using BytesLib for bytes; // BytesLib.toUint24

    // ==================== Constants ====================

    // Uniswap router function string for swapping exact amount of input tokens for a minimum of output tokens
    string internal constant SWAP_EXACT_INPUT = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))";

    // Uniswap router function string for swapping max amoutn of input tokens for an exact amount of output tokens
    string internal constant SWAP_EXACT_OUTPUT = "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))";

    // ==================== Variables ====================

    // Address of Uniswap V3 SwapRouter contract
    address public immutable _router;

    // ==================== Constructor function ====================

    /**
     * @param router    Address of Uniswap V3 SwapRouter contract
     */
    constructor(address router) {
        _router = router;
    }

    // ==================== External functions ====================

    /**
     * @dev Return calldata for trading with Uniswap V3 SwapRouter.
     * Trade paths are created from sourceToken, destinationToken and pool fees (which is encoded in data).
     *
     * ---------------------------------------------------------------------------------------------------------------
     *  isSendTokenFixed     |     Parameter             |       Amount                                              |
     * ---------------------------------------------------------------------------------------------------------------
     *      True             |    sourceQuantity         |   Fixed amount of sourceToken to trade                   |
     *                       |    destinationQuantity    |   Minimum amount of destinationToken willing to receive  |
     * ---------------------------------------------------------------------------------------------------------------
     *      False            |    sourceQuantity         |   Maximum amount of sourceToken to trade                 |
     *                       |    destinationQuantity    |   Fixed amount of destinationToken want to receive       |
     * ---------------------------------------------------------------------------------------------------------------
     *
     * @param sourceToken            Address of source token to be sold
     * @param destinationToken       Address of destination token to buy
     * @param destinationAddress     Address that assets should be transferred to
     * @param isSendTokenFixed       Boolean indicating if the send quantity is fixed, used to determine correct trade interface
     * @param sourceQuantity         Fixed/Max amount of source token to sell
     * @param destinationQuantity    Min/Fixed amount of destination token to buy
     * @param data                   Arbitrary bytes containing fees value, expressed in hundredths of a bip,
                                         used to determine the pool to trade among similar asset pools on Uniswap V3.
     *                                   Note: Matrix manager must set the appropriate pool fees via `setExchangeData` in GeneralIndexModule
     *                                   for each component that needs to be traded on UniswapV3. This is different from UniswapV3ExchangeAdapter,
     *                                   where `_data` represents UniswapV3 trade path vs just the pool fees percentage.
     *
     * @return address               Target contract address
     * @return uint256               Call value
     * @return bytes                 Trade calldata
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
            address,
            uint256,
            bytes memory
        )
    {
        uint24 fee = data.toUint24(0);

        bytes memory callData = isSendTokenFixed
            ? abi.encodeWithSignature(
                SWAP_EXACT_INPUT,
                ISwapRouter.ExactInputSingleParams(
                    sourceToken,
                    destinationToken,
                    fee,
                    destinationAddress,
                    block.timestamp,
                    sourceQuantity,
                    destinationQuantity,
                    0
                )
            )
            : abi.encodeWithSignature(
                SWAP_EXACT_OUTPUT,
                ISwapRouter.ExactOutputSingleParams(
                    sourceToken,
                    destinationToken,
                    fee,
                    destinationAddress,
                    block.timestamp,
                    destinationQuantity,
                    sourceQuantity,
                    0
                )
            );

        return (_router, 0, callData);
    }

    /**
     * @dev Returns the address to approve source tokens for trading. This is the Uniswap V3 router address.
     *
     * @return address    Address of the contract to approve tokens to
     */
    function getSpender() external view override returns (address) {
        return _router;
    }

    /**
     * @dev Helper that returns encoded fee value.
     *
     * @param fee       UniswapV3 pool fee percentage, expressed in hundredths of a bip
     *
     * @return bytes    Encoded fee value
     */
    function getEncodedFeeData(uint24 fee) external pure returns (bytes memory) {
        return abi.encodePacked(fee);
    }
}
