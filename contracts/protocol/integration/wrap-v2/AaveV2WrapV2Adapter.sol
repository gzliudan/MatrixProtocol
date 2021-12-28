// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ==================== Internal Imports ====================

import { DataTypes } from "../../../external/aave-v2/lib/DataTypes.sol";

import { IAToken } from "../../../interfaces/external/aave-v2/IAToken.sol";
import { ILendingPool } from "../../../interfaces/external/aave-v2/ILendingPool.sol";
import { IProtocolDataProvider } from "../../../interfaces/external/aave-v2/IProtocolDataProvider.sol";
import { ILendingPoolAddressesProvider } from "../../../interfaces/external/aave-v2/ILendingPoolAddressesProvider.sol";

/**
 * @title AaveV2WrapV2Adapter
 *
 * @dev Wrap adapter for Aave V2 that returns data for wraps/unwraps of tokens
 */
contract AaveV2WrapV2Adapter {
    // ==================== Variables ====================

    ILendingPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

    // ==================== Constructor function ====================

    constructor(ILendingPoolAddressesProvider addressesProvider) {
        ADDRESSES_PROVIDER = addressesProvider;
    }

    // ==================== Modifier functions ====================

    modifier onlyValidTokenPair(address underlyingToken, address wrappedToken) {
        _onlyValidTokenPair(underlyingToken, wrappedToken);
        _;
    }

    // ==================== External functions ====================

    function getWrappedTokens(address[] memory underlyingTokens)
        external
        view
        returns (
            address[] memory aTokens,
            string[] memory names,
            string[] memory symbols,
            uint8[] memory decimals
        )
    {
        aTokens = new address[](underlyingTokens.length);
        names = new string[](underlyingTokens.length);
        symbols = new string[](underlyingTokens.length);
        decimals = new uint8[](underlyingTokens.length);

        for (uint256 i = 0; i < underlyingTokens.length; i++) {
            (aTokens[i], names[i], symbols[i], decimals[i]) = getWrappedToken(underlyingTokens[i]);
        }
    }

    function getUnderlyingTokens(address[] memory wrappedTokens)
        external
        view
        returns (
            address[] memory tokens,
            string[] memory names,
            string[] memory symbols,
            uint8[] memory decimals
        )
    {
        tokens = new address[](wrappedTokens.length);
        names = new string[](wrappedTokens.length);
        symbols = new string[](wrappedTokens.length);
        decimals = new uint8[](wrappedTokens.length);

        for (uint256 i = 0; i < wrappedTokens.length; i++) {
            (tokens[i], names[i], symbols[i], decimals[i]) = getUnderlyingToken(wrappedTokens[i]);
        }
    }

    /**
     * @dev Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param underlyingToken    Address of the component to be wrapped
     * @param wrappedToken       Address of the desired wrapped token
     * @param underlyingUnits    Total quantity of underlying units to wrap
     * @param to                 Address to send the wrapped tokens to
     *
     * @return target            Target contract address
     * @return value             Total quantity of underlying units (if underlying is ETH)
     * @return callData          Wrap calldata
     */
    function getWrapCallData(
        address underlyingToken,
        address wrappedToken,
        uint256 underlyingUnits,
        address to,
        bytes memory /* wrapData */
    )
        external
        view
        onlyValidTokenPair(underlyingToken, wrappedToken)
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = ADDRESSES_PROVIDER.getLendingPool();
        callData = abi.encodeWithSignature("deposit(address,uint256,address,uint16)", underlyingToken, underlyingUnits, to, 0);
    }

    /**
     * @dev Generates the calldata to unwrap a wrapped asset into its underlying.
     *
     * @param underlyingToken      Address of the underlying asset
     * @param wrappedToken         Address of the component to be unwrapped
     * @param wrappedTokenUnits    Total quantity of wrapped token units to unwrap
     * @param to                   Address to send the unwrapped tokens to
     *
     * @return target             Target contract address
     * @return value              Total quantity of wrapped token units to unwrap. This will always be 0 for unwrapping
     * @return callData           Unwrap calldata
     */
    function getUnwrapCallData(
        address underlyingToken,
        address wrappedToken,
        uint256 wrappedTokenUnits,
        address to,
        bytes memory /* wrapData */
    )
        external
        view
        onlyValidTokenPair(underlyingToken, wrappedToken)
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = ADDRESSES_PROVIDER.getLendingPool();
        callData = abi.encodeWithSignature("withdraw(address,uint256,address)", underlyingToken, wrappedTokenUnits, to);
    }

    /**
     * @dev Returns the address to approve source tokens for wrapping.
     *
     * @return address    Address of the contract to approve tokens to
     */
    function getSpenderAddress(
        address, /* underlyingToken */
        address /* wrappedToken */
    ) external view returns (address) {
        return ADDRESSES_PROVIDER.getLendingPool();
    }

    // ==================== Public functions ====================

    function getWrappedToken(address underlyingToken)
        public
        view
        returns (
            address aToken,
            string memory name,
            string memory symbol,
            uint8 decimals
        )
    {
        if (underlyingToken != address(0)) {
            ILendingPool pool = ILendingPool(ADDRESSES_PROVIDER.getLendingPool());
            DataTypes.ReserveData memory reserve = pool.getReserveData(underlyingToken);

            if (reserve.aTokenAddress != address(0)) {
                aToken = reserve.aTokenAddress;
                name = ERC20(aToken).name();
                symbol = ERC20(aToken).symbol();
                decimals = ERC20(aToken).decimals();
            }
        }
    }

    function getUnderlyingToken(address wrappedToken)
        public
        view
        returns (
            address token,
            string memory name,
            string memory symbol,
            uint8 decimals
        )
    {
        if (wrappedToken != address(0)) {
            token = IAToken(wrappedToken).UNDERLYING_ASSET_ADDRESS();

            if (token != address(0)) {
                name = ERC20(token).name();
                symbol = ERC20(token).symbol();
                decimals = ERC20(token).decimals();
            }
        }
    }

    // ==================== Private functions ====================

    /**
     * @dev Validates the underlying and wrapped token pair
     *
     * @param underlyingToken    Address of the underlying asset
     * @param wrappedToken       Address of the wrapped asset
     */
    function _onlyValidTokenPair(address underlyingToken, address wrappedToken) private view {
        // Must be a valid token pair
        require(IAToken(wrappedToken).UNDERLYING_ASSET_ADDRESS() == underlyingToken, "A2Wb0");
    }
}
