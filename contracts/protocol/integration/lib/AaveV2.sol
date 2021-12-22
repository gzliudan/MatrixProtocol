// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { ILendingPool } from "../../../interfaces/external/aave-v2/ILendingPool.sol";

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

/**
 * @title AaveV2
 *
 * @dev Collection of helper functions for interacting with AaveV2 integrations.
 */
library AaveV2 {
    // ==================== External functions ====================

    /**
     * @dev Get deposit calldata from MatrixToken. Deposits an `amountNotional` of underlying asset into the reserve,
     * receiving in return overlying aTokens. E.g. User deposits 100 USDC and gets in return 100 aUSDC.
     *
     * @param lendingPool       Address of the LendingPool contract
     * @param asset             The address of the underlying asset to deposit
     * @param amountNotional    The amount to be deposited
     * @param onBehalfOf        The address that will receive the aTokens, same as msg.sender if the user wants to receive them on his own wallet,
     *                              or a different address if the beneficiary of aTokens is a different wallet
     * @param referralCode      Code used to register the integrator originating the operation, for potential rewards.
     *                              0 if the action is executed directly by the user, without any middle-man
     *
     * @return target          Target contract address
     * @return value           Call value
     * @return callData        Deposit calldata
     */
    function getDepositCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        address onBehalfOf,
        uint16 referralCode
    )
        public
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
        callData = abi.encodeWithSignature("deposit(address,uint256,address,uint16)", asset, amountNotional, onBehalfOf, referralCode);
    }

    /**
     * @dev Invoke deposit on LendingPool from MatrixToken. Deposits an `amountNotional` of underlying asset into the reserve,
     * receiving in return overlying aTokens.E.g. MatrixToken deposits 100 USDC and gets in return 100 aUSDC
     *
     * @param matrixToken       Address of the MatrixToken
     * @param lendingPool       Address of the LendingPool contract
     * @param asset             The address of the underlying asset to deposit
     * @param amountNotional    The amount to be deposited
     */
    function invokeDeposit(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional
    ) external {
        (address target, , bytes memory callData) = getDepositCalldata(lendingPool, asset, amountNotional, address(matrixToken), 0);

        matrixToken.invoke(target, 0, callData);
    }

    /**
     * @dev Get withdraw calldata from MatrixToken. Withdraws an `amountNotional` of underlying asset from the reserve,
     * burning the equivalent aTokens owned. E.g. User has 100 aUSDC, calls withdraw() and receives 100 USDC, burning the 100 aUSDC.
     *
     * @param lendingPool       Address of the LendingPool contract
     * @param asset             The address of the underlying asset to withdraw
     * @param amountNotional    The underlying amount to be withdraw. Passing type(uint256).max will withdraw the entire aToken balance
     * @param receiver          Address that will receive the underlying, same as msg.sender if the user wants to receive it on his own wallet,
     *                              or a different address if the beneficiary is a different wallet
     *
     * @return target           Target contract address
     * @return value            Call value
     * @return callData         Withdraw calldata
     */
    function getWithdrawCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        address receiver
    )
        public
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // withdraw(address asset, uint256 amount, address to)
        callData = abi.encodeWithSignature("withdraw(address,uint256,address)", asset, amountNotional, receiver);
    }

    /**
     * @dev Invoke withdraw on LendingPool from MatrixToken. Withdraws an `amountNotional` of underlying asset from the reserve,
     * burning the equivalent aTokens owned. E.g. MatrixToken has 100 aUSDC, and receives 100 USDC, burning the 100 aUSDC.
     *
     * @param matrixToken       Address of the MatrixToken
     * @param lendingPool       Address of the LendingPool contract
     * @param asset             The address of the underlying asset to withdraw
     * @param amountNotional    The underlying amount to be withdraw. Passing type(uint256).max will withdraw the entire aToken balance.
     *
     * @return uint256          The final amount withdraw
     */
    function invokeWithdraw(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional
    ) external returns (uint256) {
        (address target, , bytes memory callData) = getWithdrawCalldata(lendingPool, asset, amountNotional, address(matrixToken));

        return abi.decode(matrixToken.invoke(target, 0, callData), (uint256));
    }

    /**
     * @dev Get borrow calldata from MatrixToken. Allows users to borrow a specific `amountNotional` of the reserve
     * underlying `asset`, provided that the borrower already deposited enough collateral, or he was given enough
     * allowance by a credit delegator on the corresponding debt token (StableDebtToken or VariableDebtToken).
     *
     * @param lendingPool         Address of the LendingPool contract
     * @param asset               The address of the underlying asset to borrow
     * @param amountNotional      The amount to be borrowed
     * @param interestRateMode    The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
     * @param referralCode        Code used to register the integrator originating the operation, for potential rewards.
     *                                0 if the action is executed directly by the user, without any middle-man
     * @param onBehalfOf          Address of the user who will receive the debt. Should be the address of the borrower itself calling the function if he wants to
     *                                borrow against his own collateral, or the address of the credit delegator if he has been given credit delegation allowance.
     *
     * @return target             Target contract address
     * @return value              Call value
     * @return callData           Borrow calldata
     */
    function getBorrowCalldata(
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
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        callData = abi.encodeWithSignature("borrow(address,uint256,uint256,uint16,address)", asset, amountNotional, interestRateMode, referralCode, onBehalfOf);
    }

    /**
     * @dev Invoke borrow on LendingPool from MatrixToken. Allows MatrixToken to borrow a specific `amountNotional` of
     * the reserve underlying `asset`, provided that the MatrixToken already deposited enough collateral, or it was given
     * enough allowance by a credit delegator on the corresponding debt token (StableDebtToken or VariableDebtToken).
     *
     * @param matrixToken         Address of the MatrixToken
     * @param lendingPool         Address of the LendingPool contract
     * @param asset               The address of the underlying asset to borrow
     * @param amountNotional      The amount to be borrowed
     * @param interestRateMode    The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
     */
    function invokeBorrow(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode
    ) external {
        (address target, , bytes memory callData) = getBorrowCalldata(lendingPool, asset, amountNotional, interestRateMode, 0, address(matrixToken));

        matrixToken.invoke(target, 0, callData);
    }

    /**
     * @dev Get repay calldata from MatrixToken. Repays a borrowed `amountNotional` on a specific `asset` reserve, burning the
     * equivalent debt tokens owned. E.g. User repays 100 USDC, burning 100 variable/stable debt tokens of the `onBehalfOf` address.
     *
     * @param lendingPool         Address of the LendingPool contract
     * @param asset               The address of the borrowed underlying asset previously borrowed
     * @param amountNotional      The amount to repay. Passing type(uint256).max will repay the whole debt for `asset` on the specific `interestRateMode`
     * @param interestRateMode    The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     * @param onBehalfOf          Address of the user who will get his debt reduced/removed. Should be the address of the user calling the function
     *                                if he wants to reduce/remove his own debt, or the address of any other other borrower whose debt should be removed.
     *
     * @return target             Target contract address
     * @return value              Call value
     * @return callData           Repay calldata
     */
    function getRepayCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode,
        address onBehalfOf
    )
        public
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)
        callData = abi.encodeWithSignature("repay(address,uint256,uint256,address)", asset, amountNotional, interestRateMode, onBehalfOf);
    }

    /**
     * @dev Invoke repay on LendingPool from MatrixToken. Repays a borrowed `amountNotional` on a specific `asset` reserve,
     * burning the equivalent debt tokens owned. E.g. MatrixToken repays 100 USDC, burning 100 variable/stable debt tokens.
     *
     * @param matrixToken         Address of the MatrixToken
     * @param lendingPool         Address of the LendingPool contract
     * @param asset               The address of the borrowed underlying asset previously borrowed
     * @param amountNotional      The amount to repay. Passing type(uint256).max will repay the whole debt for `asset` on the specific `interestRateMode`
     * @param interestRateMode    The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     *
     * @return uint256            The final amount repaid
     */
    function invokeRepay(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 amountNotional,
        uint256 interestRateMode
    ) external returns (uint256) {
        (address target, , bytes memory callData) = getRepayCalldata(lendingPool, asset, amountNotional, interestRateMode, address(matrixToken));

        return abi.decode(matrixToken.invoke(target, 0, callData), (uint256));
    }

    /**
     * @dev Get setUserUseReserveAsCollateral calldata from MatrixToken. Allows borrower to enable/disable a specific deposited asset as collateral
     *
     * @param lendingPool        Address of the LendingPool contract
     * @param asset              The address of the underlying asset deposited
     * @param useAsCollateral    true` if the user wants to use the deposit as collateral, `false` otherwise
     *
     * @return target           Target contract address
     * @return value           Call value
     * @return callData             SetUserUseReserveAsCollateral calldata
     */
    function getSetUserUseReserveAsCollateralCalldata(
        ILendingPool lendingPool,
        address asset,
        bool useAsCollateral
    )
        public
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // setUserUseReserveAsCollateral(address asset, bool useAsCollateral)
        callData = abi.encodeWithSignature("setUserUseReserveAsCollateral(address,bool)", asset, useAsCollateral);
    }

    /**
     * @dev Invoke an asset to be used as collateral on Aave from MatrixToken. Allows MatrixToken to enable/disable a specific deposited asset as collateral.
     *
     * @param matrixToken        Address of the MatrixToken
     * @param lendingPool        Address of the LendingPool contract
     * @param asset              The address of the underlying asset deposited
     * @param useAsCollateral    true` if the user wants to use the deposit as collateral, `false` otherwise
     */
    function invokeSetUserUseReserveAsCollateral(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        bool useAsCollateral
    ) external {
        (address target, , bytes memory callData) = getSetUserUseReserveAsCollateralCalldata(lendingPool, asset, useAsCollateral);

        matrixToken.invoke(target, 0, callData);
    }

    /**
     * @dev Get swapBorrowRate calldata from MatrixToken. Allows a borrower to toggle his debt between stable and variable mode.
     *
     * @param lendingPool    Address of the LendingPool contract
     * @param asset          The address of the underlying asset borrowed
     * @param rateMode       The rate mode that the user wants to swap to
     *
     * @return target        Target contract address
     * @return value         Call value
     * @return callData      SwapBorrowRate calldata
     */
    function getSwapBorrowRateModeCalldata(
        ILendingPool lendingPool,
        address asset,
        uint256 rateMode
    )
        public
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(lendingPool);

        // swapBorrowRateMode(address asset, uint256 rateMode)
        callData = abi.encodeWithSignature("swapBorrowRateMode(address,uint256)", asset, rateMode);
    }

    /**
     * @dev Invoke to swap borrow rate of MatrixToken. Allows MatrixToken to toggle it's debt between stable and variable mode.
     *
     * @param matrixToken    Address of the MatrixToken
     * @param lendingPool    Address of the LendingPool contract
     * @param asset          The address of the underlying asset borrowed
     * @param rateMode       The rate mode that the user wants to swap to
     */
    function invokeSwapBorrowRateMode(
        IMatrixToken matrixToken,
        ILendingPool lendingPool,
        address asset,
        uint256 rateMode
    ) external {
        (address target, , bytes memory callData) = getSwapBorrowRateModeCalldata(lendingPool, asset, rateMode);

        matrixToken.invoke(target, 0, callData);
    }
}
