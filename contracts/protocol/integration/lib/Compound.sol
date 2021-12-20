// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { ICErc20 } from "../../../interfaces/external/ICErc20.sol";
import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";
import { IComptroller } from "../../../interfaces/external/IComptroller.sol";

/**
 * @title Compound
 *
 * @dev Collection of helper functions for interacting with Compound integrations
 */
library Compound {
    // ==================== External functions ====================

    /**
     * @dev Get enter markets calldata from MatrixToken.
     */
    function getEnterMarketsCalldata(ICErc20 cToken, IComptroller comptroller)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        address[] memory marketsToEnter = new address[](1);
        marketsToEnter[0] = address(cToken);

        // Compound's enter market function signature is: enterMarkets(address[] cTokens
        bytes memory callData = abi.encodeWithSignature("enterMarkets(address[])", marketsToEnter);

        return (address(comptroller), 0, callData);
    }

    /**
     * @dev Invoke enter markets from MatrixToken
     */
    function invokeEnterMarkets(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        IComptroller comptroller
    ) external {
        (, , bytes memory enterMarketsCalldata) = getEnterMarketsCalldata(cToken, comptroller);
        uint256[] memory returnValues = abi.decode(matrixToken.invoke(address(comptroller), 0, enterMarketsCalldata), (uint256[]));
        require(returnValues[0] == 0, "CMPD0");
    }

    /**
     * @dev Get exit market calldata from MatrixToken.
     */
    function getExitMarketCalldata(ICErc20 cToken, IComptroller comptroller)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's exit market function signature is: exitMarket(address cToken)
        bytes memory callData = abi.encodeWithSignature("exitMarket(address)", address(cToken));

        return (address(comptroller), 0, callData);
    }

    /**
     * @dev Invoke exit market from MatrixToken
     */
    function invokeExitMarket(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        IComptroller comptroller
    ) external {
        (, , bytes memory exitMarketCalldata) = getExitMarketCalldata(cToken, comptroller);
        require(abi.decode(matrixToken.invoke(address(comptroller), 0, exitMarketCalldata), (uint256)) == 0, "CMPD1");
    }

    /**
     * @dev Get mint cEther calldata from MatrixToken.
     */
    function getMintCEtherCalldata(ICErc20 cEther, uint256 mintNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's mint cEther function signature is: mint(). No return, reverts on error.
        bytes memory callData = abi.encodeWithSignature("mint()");

        return (address(cEther), mintNotional, callData);
    }

    /**
     * @dev Invoke mint cEther from the MatrixToken
     */
    function invokeMintCEther(
        IMatrixToken matrixToken,
        ICErc20 cEther,
        uint256 mintNotional
    ) external {
        (, , bytes memory mintCEtherCalldata) = getMintCEtherCalldata(cEther, mintNotional);
        matrixToken.invoke(address(cEther), mintNotional, mintCEtherCalldata);
    }

    /**
     * @dev Get mint cToken calldata from MatrixToken.
     */
    function getMintCTokenCalldata(ICErc20 cToken, uint256 mintNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's mint cToken function signature is: mint(uint256 mintAmount). Returns 0 if success
        bytes memory callData = abi.encodeWithSignature("mint(uint256)", mintNotional);

        return (address(cToken), mintNotional, callData);
    }

    /**
     * @dev Invoke mint from the MatrixToken. Mints the specified cToken from the underlying of the specified notional quantity
     */
    function invokeMintCToken(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 mintNotional
    ) external {
        (, , bytes memory mintCTokenCalldata) = getMintCTokenCalldata(cToken, mintNotional);

        require(abi.decode(matrixToken.invoke(address(cToken), 0, mintCTokenCalldata), (uint256)) == 0, "CMPD2");
    }

    /**
     * @dev Get redeem underlying calldata.
     */
    function getRedeemUnderlyingCalldata(ICErc20 cToken, uint256 redeemNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's redeem function signature is: redeemUnderlying(uint256 underlyingAmount)
        bytes memory callData = abi.encodeWithSignature("redeemUnderlying(uint256)", redeemNotional);

        return (address(cToken), redeemNotional, callData);
    }

    /**
     * @dev Invoke redeem underlying from the MatrixToken
     */
    function invokeRedeemUnderlying(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 redeemNotional
    ) external {
        (, , bytes memory redeemUnderlyingCalldata) = getRedeemUnderlyingCalldata(cToken, redeemNotional);

        require(abi.decode(matrixToken.invoke(address(cToken), 0, redeemUnderlyingCalldata), (uint256)) == 0, "CMPD3");
    }

    /**
     * @dev Get redeem calldata
     */
    function getRedeemCalldata(ICErc20 cToken, uint256 redeemNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        bytes memory callData = abi.encodeWithSignature("redeem(uint256)", redeemNotional);

        return (address(cToken), redeemNotional, callData);
    }

    /**
     * @dev Invoke redeem from the MatrixToken
     */
    function invokeRedeem(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 redeemNotional
    ) external {
        (, , bytes memory redeemCalldata) = getRedeemCalldata(cToken, redeemNotional);

        require(abi.decode(matrixToken.invoke(address(cToken), 0, redeemCalldata), (uint256)) == 0, "CMPD4");
    }

    /**
     * @dev Get repay borrow calldata
     */
    function getRepayBorrowCEtherCalldata(ICErc20 cToken, uint256 repayNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's repay ETH function signature is: repayBorrow(). No return, revert on fail
        bytes memory callData = abi.encodeWithSignature("repayBorrow()");

        return (address(cToken), repayNotional, callData);
    }

    /**
     * @dev Invoke repay cEther from the MatrixToken
     */
    function invokeRepayBorrowCEther(
        IMatrixToken matrixToken,
        ICErc20 cEther,
        uint256 repayNotional
    ) external {
        (, , bytes memory repayBorrowCalldata) = getRepayBorrowCEtherCalldata(cEther, repayNotional);
        matrixToken.invoke(address(cEther), repayNotional, repayBorrowCalldata);
    }

    /**
     * @dev Get repay borrow calldata
     */
    function getRepayBorrowCTokenCalldata(ICErc20 cToken, uint256 repayNotional)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Compound's repay asset function signature is: repayBorrow(uint256 _repayAmount)
        bytes memory callData = abi.encodeWithSignature("repayBorrow(uint256)", repayNotional);

        return (address(cToken), repayNotional, callData);
    }

    /**
     * @dev Invoke repay cToken from the MatrixToken
     */
    function invokeRepayBorrowCToken(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 repayNotional
    ) external {
        (, , bytes memory repayBorrowCalldata) = getRepayBorrowCTokenCalldata(cToken, repayNotional);
        require(abi.decode(matrixToken.invoke(address(cToken), 0, repayBorrowCalldata), (uint256)) == 0, "CMPD5");
    }

    /**
     * @dev Get borrow calldata
     */
    function getBorrowCalldata(ICErc20 cToken, uint256 _notionalBorrowQuantity)
        public
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        /// @notice Notional borrow quantity is in units of underlying asset
        // Compound's borrow function signature is: borrow(uint256 _borrowAmount).
        bytes memory callData = abi.encodeWithSignature("borrow(uint256)", _notionalBorrowQuantity);

        return (address(cToken), 0, callData);
    }

    /**
     * @dev Invoke the MatrixToken to interact with the specified cToken to borrow the cToken's underlying of the specified borrowQuantity.
     */
    function invokeBorrow(
        IMatrixToken matrixToken,
        ICErc20 cToken,
        uint256 _notionalBorrowQuantity
    ) external {
        (, , bytes memory borrowCalldata) = getBorrowCalldata(cToken, _notionalBorrowQuantity);
        require(abi.decode(matrixToken.invoke(address(cToken), 0, borrowCalldata), (uint256)) == 0, "CMPD6");
    }
}
