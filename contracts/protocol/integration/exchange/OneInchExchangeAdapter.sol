// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title OneInchExchangeAdapter
 * @dev Exchange adapter for 1Inch exchange that returns data for trades
 */

contract OneInchExchangeAdapter {
    // ==================== Variables ====================

    // Address of 1Inch approve token address
    address internal _oneInchApprovalAddress;

    // Address of 1Inch exchange address
    address internal _oneInchExchangeAddress;

    // Bytes to check 1Inch function signature
    bytes4 internal _oneInchFunctionSignature;

    // ==================== Constructor function ====================

    constructor(
        address oneInchApprovalAddress,
        address oneInchExchangeAddress,
        bytes4 oneInchFunctionSignature
    ) {
        _oneInchApprovalAddress = oneInchApprovalAddress;
        _oneInchExchangeAddress = oneInchExchangeAddress;
        _oneInchFunctionSignature = oneInchFunctionSignature;
    }

    // ==================== External functions ====================

    function getExchangeAddress() external view returns(address) {
        return _oneInchExchangeAddress;
    }

    function getFunctionSignature() external view returns(bytes4) {
        return _oneInchFunctionSignature;
    }

    /**
     * Return 1inch calldata which is already generated from the 1inch API
     *
     * @param sourceToken               Address of source token to be sold
     * @param destinationToken          Address of destination token to buy
     * @param sourceQuantity            Amount of source token to sell
     * @param minDestinationQuantity    Min amount of destination token to buy
     * @param data                      Arbitrage bytes containing trade call data
     *
     * @return address                  Target contract address
     * @return uint256                  Call value
     * @return bytes                    Trade calldata
     */
    function getTradeCalldata(
        address sourceToken,
        address destinationToken,
        address, /* _destinationAddress */
        uint256 sourceQuantity,
        uint256 minDestinationQuantity,
        bytes memory data
    )
        external
        view
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        bytes4 signature;
        address fromToken;
        address toToken;
        uint256 fromTokenAmount;
        uint256 minReturnAmount;

        // Parse 1inch calldata and validate parameters match expected inputs
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            signature := mload(add(data, 32))
            fromToken := mload(add(data, 36))
            toToken := mload(add(data, 68))
            fromTokenAmount := mload(add(data, 100))
            minReturnAmount := mload(add(data, 132))
        }

        require(signature == _oneInchFunctionSignature, "OIEA0a"); // "Not One Inch Swap Function"
        require(fromToken == sourceToken, "OIEA0b"); // Invalid send token
        require(toToken == destinationToken, "OIEA0c"); // Invalid receive token
        require(fromTokenAmount == sourceQuantity, "OIEA0d"); // Source quantity mismatch
        require(minReturnAmount >= minDestinationQuantity, "OIEA0e"); // Min destination quantity mismatch

        return (_oneInchExchangeAddress, 0, data);
    }

    /**
     * @dev Returns the TokenTaker address to approve trading.
     */
    function getSpender() external view returns (address) {
        return _oneInchApprovalAddress;
    }
}
