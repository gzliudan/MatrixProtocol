// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

/**
 * @title DebtIssuanceMock
 */
contract DebtIssuanceMock {
    // ==================== Variables ====================

    mapping(IMatrixToken => bool) internal _isRegistered;

    // ==================== External functions ====================

    function isRegistered(IMatrixToken matrixToken) external view returns (bool) {
        return _isRegistered[matrixToken];
    }

    function initialize(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
    }

    function removeModule() external {}

    function registerToIssuanceModule(IMatrixToken matrixToken) external {
        _isRegistered[matrixToken] = true;
    }

    function unregisterFromIssuanceModule(IMatrixToken matrixToken) external {
        _isRegistered[matrixToken] = false;
    }
}
