// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

// ==================== Internal Imports ====================

import { AddressArrayUtil } from "../lib/AddressArrayUtil.sol";

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";
import { INavIssuanceHook } from "../interfaces/INavIssuanceHook.sol";

/**
 * @title AssetLimitHook
 *
 * @dev NavIssuanceModule hook that checks the issue and redeem amounts are lower than a given limit.
 */
contract AssetLimitHook is INavIssuanceHook, AccessControl {
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Variables ====================

    address[] public _assets;
    mapping(address => uint256) public _assetLimits;

    // ==================== Constructor function ====================

    constructor(address[] memory assets, uint256[] memory limits) {
        require(assets.length != 0, "AL0a");
        require(assets.length == limits.length, "AL0b");

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            require(_assetLimits[asset] == 0, "AL0c");
            _assetLimits[asset] = limits[i];
        }

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
        _assets = assets;
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function getAssets() external view returns (address[] memory) {
        return _assets;
    }

    function invokePreIssueHook(
        IMatrixToken, /* matrixToken */
        address reserveAsset,
        uint256 reserveAssetQuantity,
        address, /* sender */
        address /* to */
    ) external view override {
        require(reserveAssetQuantity <= _assetLimits[reserveAsset], "AL1");
    }

    function invokePreRedeemHook(
        IMatrixToken matrixToken,
        uint256 redeemQuantity,
        address, /* sender */
        address /* to */
    ) external view override {
        require(redeemQuantity <= _assetLimits[address(matrixToken)], "AL2");
    }

    function addAssetLimit(address asset, uint256 newLimit) external onlyAdmin {
        require(_assetLimits[asset] == 0, "AL3");

        _assetLimits[asset] = newLimit;
        _assets.push(asset);
    }

    function editAssetLimit(address asset, uint256 newLimit) external onlyAdmin {
        require(_assetLimits[asset] != 0, "AL4");

        _assetLimits[asset] = newLimit;
    }

    function removeAssetLimit(address asset) external onlyAdmin {
        require(_assetLimits[asset] != 0, "AL5");

        delete _assetLimits[asset];
        _assets.quickRemoveItem(asset);
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "AL6");
    }
}
