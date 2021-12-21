// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";

import { IVault } from "../../../interfaces/external/perp-v2/IVault.sol";
import { IQuoter } from "../../../interfaces/external/perp-v2/IQuoter.sol";
import { IClearingHouse } from "../../../interfaces/external/perp-v2/IClearingHouse.sol";

/**
 * @title PerpV2
 *
 * @dev Collection of helper functions for interacting with PerpV2 integrations.
 */
library PerpV2 {
    // ==================== External functions ====================

    /**
     * @dev Gets Perp vault `deposit` calldata. When invoked, calldata deposits an `amountNotional` of collateral asset into the Perp Protocol vault
     *
     * @param  vault             Perp protocol vault
     * @param  asset             Collateral asset to deposit
     * @param  amountNotional    Notional amount in collateral decimals to deposit
     *
     * @return address           Vault address
     * @return uint256           Call value
     * @return calldata          Deposit calldata
     */
    function getDepositCalldata(IVault vault, IERC20 asset, uint256 amountNotional) public pure returns (address, uint256, bytes memory) {
        bytes memory callData = abi.encodeWithSignature("deposit(address,uint256)", asset, amountNotional); // prettier-ignore

        return (address(vault), 0, callData);
    } // prettier-ignore

    /**
     * @dev Invoke `deposit` on Vault from MatrixToken. Deposits an `amountNotional` of collateral asset into the Perp Protocol vault
     *
     * @param matrixToken       Address of the MatrixToken
     * @param vault             Address of Perp Protocol vault contract
     * @param asset             The address of the collateral asset to deposit
     * @param amountNotional    Notional amount in collateral decimals to deposit
     */
    function invokeDeposit(IMatrixToken matrixToken, IVault vault, IERC20 asset, uint256 amountNotional) external {
        (, , bytes memory depositCalldata) = getDepositCalldata(vault, asset, amountNotional);

        matrixToken.invoke(address(vault), 0, depositCalldata);
    } // prettier-ignore

    /**
     * @dev Get Perp Vault `withdraw` method calldata. When invoked, calldata withdraws an `amountNotional` of collateral asset from the Perp protocol vault.
     *
     * @param vault             Address of the Perp Protocol vault contract
     * @param asset             The address of the collateral asset to withdraw
     * @param amountNotional    The notional amount in collateral decimals to be withdrawn
     *
     * @return address          Vault contract address
     * @return uint256          Call value
     * @return bytes            Withdraw calldata
     */
    function getWithdrawCalldata(IVault vault, IERC20 asset, uint256 amountNotional) public pure returns (address, uint256, bytes memory) {
        bytes memory callData = abi.encodeWithSignature("withdraw(address,uint256)", asset, amountNotional);

        return (address(vault), 0, callData);
    } // prettier-ignore

    /**
     * @dev Invoke `withdraw` on Vault from MatrixToken. Withdraws an `amountNotional` of collateral asset from the Perp protocol vault.
     *
     * @param matrixToken       Address of the MatrixToken
     * @param vault             Address of the Perp Protocol vault contract
     * @param asset             The address of the collateral asset to withdraw
     * @param amountNotional    The notional amount in collateral decimals to be withdrawn     *
     */
    function invokeWithdraw(IMatrixToken matrixToken, IVault vault, IERC20 asset, uint256 amountNotional) external {
        (, , bytes memory withdrawCalldata) = getWithdrawCalldata(vault, asset, amountNotional);

        matrixToken.invoke(address(vault), 0, withdrawCalldata);
    } // prettier-ignore

    /**
     * @dev Get Perp ClearingHouse `openPosition` method calldata. When invoked, calldata executes a trade via the Perp protocol ClearingHouse contract.
     *
     * @param clearingHouse    Address of the Clearinghouse contract
     * @param params           OpenPositionParams struct. For details see definition in contracts/interfaces/external/perp-v2/IClearingHouse.sol
     *
     * @return address         ClearingHouse contract address
     * @return uint256         Call value
     * @return bytes          `openPosition` calldata
     */
    function getOpenPositionCalldata(IClearingHouse clearingHouse, IClearingHouse.OpenPositionParams memory params)
        public pure returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature("openPosition((address,bool,bool,uint256,uint256,uint256,uint160,bytes32))", params);

        return (address(clearingHouse), 0, callData);
    } // prettier-ignore

    /**
     * @dev Invoke `openPosition` on ClearingHouse from MatrixToken. Executes a trade via the Perp protocol ClearingHouse contract.
     *
     * @param matrixToken      Address of the MatrixToken
     * @param clearingHouse    Address of the Clearinghouse contract
     * @param params           OpenPositionParams struct. For details see definition
     *                         in contracts/interfaces/external/perp-v2/IClearingHouse.sol
     *
     * @return deltaBase       Positive or negative change in base token balance resulting from trade
     * @return deltaQuote      Positive or negative change in quote token balance resulting from trade
     */
    function invokeOpenPosition(IMatrixToken matrixToken, IClearingHouse clearingHouse, IClearingHouse.OpenPositionParams memory params)
        external returns (uint256 deltaBase, uint256 deltaQuote)
    {
        (, , bytes memory openPositionCalldata) = getOpenPositionCalldata(clearingHouse, params);
        bytes memory returnValue = matrixToken.invoke(address(clearingHouse), 0, openPositionCalldata);

        return abi.decode(returnValue, (uint256, uint256));
    } // prettier-ignore

    /**
     * @dev Get Perp Quoter `swap` method calldata. When invoked, calldata simulates a trade on the Perp exchange via the Perp periphery contract Quoter.
     *
     * @param quoter      Address of the Quoter contract
     * @param params      SwapParams struct. For details see definition in contracts/interfaces/external/perp-v2/IQuoter.sol
     *
     * @return address    ClearingHouse contract address
     * @return uint256    Call value
     * @return bytes     `swap` calldata
     */
    function getSwapCalldata(IQuoter quoter, IQuoter.SwapParams memory params) public pure returns (address, uint256, bytes memory) {
        bytes memory callData = abi.encodeWithSignature("swap((address,bool,bool,uint256,uint160))", params);

        return (address(quoter), 0, callData);
    } // prettier-ignore

    /**
     * @dev Invoke `swap` method on Perp Quoter contract. Simulates a trade on the Perp exchange via the Perp periphery contract Quoter.
     *
     * @param matrixToken      Address of the MatrixToken
     * @param quoter           Address of the Quoter contract
     * @param params           SwapParams struct. For details see definition in contracts/interfaces/external/perp-v2/IQuoter.sol
     *
     * @return swapResponse    Struct which includes deltaAvailableBase and deltaAvailableQuote properties (equiv. to deltaQuote, deltaBase) returned from `openPostion`
     */
    function invokeSwap(IMatrixToken matrixToken, IQuoter quoter, IQuoter.SwapParams memory params) external returns (IQuoter.SwapResponse memory) {
        (, , bytes memory swapCalldata) = getSwapCalldata(quoter, params);
        bytes memory returnValue = matrixToken.invoke(address(quoter), 0, swapCalldata);

        return abi.decode(returnValue, (IQuoter.SwapResponse));
    } // prettier-ignore
}
