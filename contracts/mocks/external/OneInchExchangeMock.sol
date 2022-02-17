// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

// Mock contract implementation of 1Inch
contract OneInchExchangeMock {
    using SafeMath for uint256;

    address internal _mockReceiveToken;
    address internal _mockSendToken;
    uint256 internal _mockReceiveAmount;
    uint256 internal _mockSendAmount;

    // Address of MatrixToken which will send/receive token
    address internal _matrixTokenAddress;

    constructor(
        address mockSendToken,
        address mockReceiveToken,
        uint256 mockSendAmount,
        uint256 mockReceiveAmount
    ) {
        _mockSendToken = mockSendToken;
        _mockReceiveToken = mockReceiveToken;
        _mockSendAmount = mockSendAmount;
        _mockReceiveAmount = mockReceiveAmount;
    }

    // Initialize MatrixToken address which will send/receive tokens for the trade
    function addMatrixTokenAddress(address matrixTokenAddress) external {
        _matrixTokenAddress = matrixTokenAddress;
    }

    function updateSendAmount(uint256 newSendAmount) external {
        _mockSendAmount = newSendAmount;
    }

    function updateReceiveAmount(uint256 newReceiveAmount) external {
        _mockReceiveAmount = newReceiveAmount;
    }

    function swap(
        address, /* fromToken */
        address, /* toToken */
        uint256, /* fromTokenAmount */
        uint256, /* minReturnAmount */
        uint256, /* guaranteedAmount */
        address payable, /* referrer */
        address[] calldata, /* callAddresses */
        bytes calldata, /* callDataConcat */
        uint256[] memory, /* starts */
        uint256[] memory /* gasLimitsAndValues */
    ) external payable returns (uint256 returnAmount) {
        require(ERC20(_mockSendToken).transferFrom(_matrixTokenAddress, address(this), _mockSendAmount), "ERC20 TransferFrom failed");
        require(ERC20(_mockReceiveToken).transfer(_matrixTokenAddress, _mockReceiveAmount), "ERC20 transfer failed");

        return _mockReceiveAmount;
    }
}
