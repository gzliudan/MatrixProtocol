// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../../interfaces/IMatrixToken.sol";
import { ILendingPool } from "../../../../interfaces/external/aave-v2/ILendingPool.sol";

import { AaveV2 } from "../../../../protocol/integration/lib/AaveV2.sol";

/**
 * @title AaveV2Mock
 *
 * @dev Mock for AaveV2 Library contract. Used for testing AaveV2 Library contract.
 */
contract AaveV2Mock {
    // ==================== External functions ====================

    function testGetDepositCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        address onBehalfOf,
        uint16 referralCode
    )
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getDepositCalldata(lendingPool, asset, amountNotional, onBehalfOf, referralCode);
    }

    function testInvokeDeposit(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional
    ) external {
        return AaveV2.invokeDeposit(matrixToken, lendingPool, asset, amountNotional);
    }

    function testGetWithdrawCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        address receiver
    )
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getWithdrawCalldata(lendingPool, asset, amountNotional, receiver);
    }

    function testInvokeWithdraw(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional
    ) external returns (uint256) {
        return AaveV2.invokeWithdraw(matrixToken, lendingPool, asset, amountNotional);
    }

    function testGetBorrowCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    )
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getBorrowCalldata(lendingPool, asset, amountNotional, interestRateMode, referralCode, onBehalfOf);
    }

    function testInvokeBorrow(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode
    ) external {
        return AaveV2.invokeBorrow(matrixToken, lendingPool, asset, amountNotional, interestRateMode);
    }

    function testGetRepayCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode,
        address onBehalfOf
    )
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getRepayCalldata(lendingPool, asset, amountNotional, interestRateMode, onBehalfOf);
    }

    function testInvokeRepay(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode
    ) external returns (uint256) {
        return AaveV2.invokeRepay(matrixToken, lendingPool, asset, amountNotional, interestRateMode);
    }

    function testGetSetUserUseReserveAsCollateralCalldata(
        ILendingPool lendingPool,
        address asset,
        bool useAsCollateral
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getSetUserUseReserveAsCollateralCalldata(lendingPool, asset, useAsCollateral);
    }

    function testInvokeSetUserUseReserveAsCollateral(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        bool useAsCollateral
    ) external {
        return AaveV2.invokeSetUserUseReserveAsCollateral(matrixToken, lendingPool, asset, useAsCollateral);
    }

    function testGetSwapBorrowRateModeCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 rateMode
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        return AaveV2.getSwapBorrowRateModeCalldata(lendingPool, asset, rateMode);
    }

    function testInvokeSwapBorrowRateMode(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 rateMode
    ) external {
        return AaveV2.invokeSwapBorrowRateMode(matrixToken, lendingPool, asset, rateMode);
    }

    function initializeModule(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
    }
}
