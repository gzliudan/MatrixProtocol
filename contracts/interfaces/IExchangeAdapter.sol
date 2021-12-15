// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IExchangeAdapter
 */
interface IExchangeAdapter {
    // ==================== External functions ====================

    function getSpender() external view returns (address);

    /**
     * @param srcToken           Address of source token to be sold
     * @param destToken          Address of destination token to buy
     * @param destAddress        Address that assets should be transferred to
     * @param srcQuantity        Amount of source token to sell
     * @param minDestQuantity    Min amount of destination token to buy
     * @param data               Arbitrary bytes containing trade call data
     *
     * @return target            Target contract address
     * @return value             Call value
     * @return callData          Trade calldata
     */
    function getTradeCalldata(
        address srcToken,
        address destToken,
        address destAddress,
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
        );
}
