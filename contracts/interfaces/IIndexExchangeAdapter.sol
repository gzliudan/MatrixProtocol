// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IIndexExchangeAdapter
 */
interface IIndexExchangeAdapter {
    // ==================== External functions ====================

    function getSpender() external view returns (address);

    /**
     * @dev Returns calldata for executing trade on given adapter's exchange when using the GeneralIndexModule.
     *
     * @param sourceToken            Address of source token to be sold
     * @param destinationToken       Address of destination token to buy
     * @param destinationAddress     Address that assets should be transferred to
     * @param isSendTokenFixed       Boolean indicating if the send quantity is fixed, used to determine correct trade interface
     * @param sourceQuantity         Fixed/Max amount of source token to sell
     * @param destinationQuantity    Min/Fixed amount of destination tokens to receive
     * @param data                   Arbitrary bytes that can be used to store exchange specific parameters or logic
     *
     * @return address               Target contract address
     * @return uint256               Call value
     * @return bytes                 Trade calldata
     */
    function getTradeCalldata(address sourceToken, address destinationToken, address destinationAddress, bool isSendTokenFixed,
        uint256 sourceQuantity, uint256 destinationQuantity, bytes memory data) external view returns (address, uint256, bytes memory); // prettier-ignore
}
