// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IExchangeAdapter } from "../../../interfaces/IExchangeAdapter.sol";

/**
 * @title UniswapV2TransferFeeExchangeAdapter
 *
 * @dev Uniswap V2 Exchange adapter that supports trading tokens with transfer fees
 */
contract UniswapV2TransferFeeExchangeAdapter is IExchangeAdapter {
    // ==================== Variables ====================

    address public immutable _router; // Address of Uniswap V2 Router02

    // ==================== Constructor function ====================

    constructor(address router) {
        _router = router;
    }

    // ==================== External functions ====================

    /**
     * @dev Return calldata for Uniswap V2 Router02 when trading a token with a transfer fee
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
        require(srcToken != address(0), "UbFEA0a");
        require(destToken != address(0), "UbFEA0b");
        require(to != address(0), "UbFEA0c");

        address[] memory path;

        if (data.length == 0) {
            path = new address[](2);
            path[0] = srcToken;
            path[1] = destToken;
        } else {
            path = abi.decode(data, (address[]));
            require(path.length >= 2, "UbFEA0d");
        }

        value = 0;
        target = _router;

        // swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        callData = abi.encodeWithSignature(
            "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
            srcQuantity, // amountIn
            minDestQuantity, // amountOutMin
            path, // path
            to, // to
            block.timestamp // deadline
        );
    }

    /**
     * @dev Returns the Uniswap _router address to approve source tokens for trading.
     */
    function getSpender() external view returns (address) {
        return _router;
    }
}
