// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

contract InvokeMock {
    /* ============ External Functions ============ */

    function testInvokeApprove(
        IMatrixToken matrixToken,
        address token,
        address spender,
        uint256 quantity
    ) external {
        matrixToken.invokeSafeIncreaseAllowance(token, spender, quantity);
    }

    function testInvokeTransfer(
        IMatrixToken matrixToken,
        address token,
        address spender,
        uint256 quantity
    ) external {
        matrixToken.invokeSafeTransfer(token, spender, quantity);
    }

    function testStrictInvokeTransfer(
        IMatrixToken matrixToken,
        address token,
        address spender,
        uint256 quantity
    ) external {
        matrixToken.invokeExactSafeTransfer(token, spender, quantity);
    }

    function testInvokeUnwrapWETH(
        IMatrixToken matrixToken,
        address weth,
        uint256 quantity
    ) external {
        matrixToken.invokeUnwrapWETH(weth, quantity);
    }

    function testInvokeWrapWETH(
        IMatrixToken matrixToken,
        address weth,
        uint256 quantity
    ) external {
        matrixToken.invokeWrapWETH(weth, quantity);
    }

    function initializeModule(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
    }
}
