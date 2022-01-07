// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

/**
 * @title NavIssuanceHookMock
 */
contract NavIssuanceHookMock {
    // ==================== Variables ====================

    IMatrixToken internal _matrixToken;
    address internal _reserveAsset;
    uint256 internal _reserveAssetQuantity;
    address internal _sender;
    uint256 internal _redeemQuantity;
    address internal _to;

    // ==================== External functions ====================

    function getToken() external view returns (address) {
        return address(_matrixToken);
    }

    function getReserveAsset() external view returns (address) {
        return _reserveAsset;
    }

    function getReserveAssetQuantity() external view returns (uint256) {
        return _reserveAssetQuantity;
    }

    function getSender() external view returns (address) {
        return _sender;
    }

    function getRedeemQuantity() external view returns (uint256) {
        return _redeemQuantity;
    }

    function getTo() external view returns (address) {
        return _to;
    }

    function invokePreIssueHook(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity,
        address sender,
        address to
    ) external {
        _matrixToken = matrixToken;
        _reserveAsset = reserveAsset;
        _reserveAssetQuantity = reserveAssetQuantity;
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
        _redeemQuantity = redeemQuantity;
        _sender = sender;
        _to = to;
    }
}
