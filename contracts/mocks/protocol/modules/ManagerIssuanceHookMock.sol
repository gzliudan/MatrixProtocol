// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

/**
 * @title ManagerIssuanceHookMock
 */
contract ManagerIssuanceHookMock {
    // ==================== Variables ====================

    IMatrixToken internal _matrixToken;
    uint256 internal _quantity;
    address internal _sender;
    address internal _to;

    // ==================== External functions ====================

    function getToken() external view returns (address) {
        return address(_matrixToken);
    }

    function getQuantity() external view returns (uint256) {
        return _quantity;
    }

    function getSender() external view returns (address) {
        return _sender;
    }

    function getTo() external view returns (address) {
        return _to;
    }

    function invokePreIssueHook(
        IMatrixToken matrixToken,
        uint256 issueQuantity,
        address sender,
        address to
    ) external {
        _matrixToken = matrixToken;
        _quantity = issueQuantity;
        _sender = sender;
        _to = to;
    }

    function invokePreRedeemHook(
        IMatrixToken matrixToken,
        uint256 redeemQuantity,
        address sender,
        address to
    ) external {
        _matrixToken = matrixToken;
        _quantity = redeemQuantity;
        _sender = sender;
        _to = to;
    }
}
