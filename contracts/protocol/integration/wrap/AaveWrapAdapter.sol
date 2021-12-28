// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IAaveLendingPool } from "../../../interfaces/external/IAaveLendingPool.sol";
import { IAaveLendingPoolCore } from "../../../interfaces/external/IAaveLendingPoolCore.sol";

/**
 * @title AaveWrapAdapter
 *
 * @dev Wrap adapter for Aave that returns data for wraps/unwraps of tokens
 */
contract AaveWrapAdapter {
    // ==================== Constants ====================

    // Aave Mock address to indicate ETH. ETH is used directly in Aave protocol (instead of an abstraction such as WETH)
    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ==================== Variables ====================

    // Address of Aave Lending Pool to deposit underlying/reserve tokens
    IAaveLendingPool public immutable _aaveLendingPool;

    // Address of Aave Lending Pool Core to send approvals
    IAaveLendingPoolCore public immutable _aaveLendingPoolCore;

    // ==================== Constructor function ====================

    /**
     * @param aaveLendingPool    Address of Aave Lending Pool to deposit underlying/reserve tokens
     */
    constructor(IAaveLendingPool aaveLendingPool) {
        _aaveLendingPool = aaveLendingPool;
        _aaveLendingPoolCore = IAaveLendingPoolCore(aaveLendingPool.core());
    }

    // ==================== Modifier functions ====================

    modifier onlyValidTokenPair(address underlyingToken, address wrappedToken) {
        _onlyValidTokenPair(underlyingToken, wrappedToken);
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param underlyingToken    Address of the component to be wrapped
     * @param wrappedToken       Address of the desired wrapped token
     * @param underlyingUnits    Total quantity of underlying units to wrap
     *
     * @return address           Target contract address
     * @return uint256           Total quantity of underlying units (if underlying is ETH)
     * @return bytes             Wrap calldata
     */
    function getWrapCallData(
        address underlyingToken,
        address wrappedToken,
        uint256 underlyingUnits
    )
        external
        view
        onlyValidTokenPair(underlyingToken, wrappedToken)
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        uint256 value = underlyingToken == ETH_TOKEN_ADDRESS ? underlyingUnits : 0;

        // deposit(address _reserve, uint256 _amount, uint16 _referralCode)
        bytes memory callData = abi.encodeWithSignature("deposit(address,uint256,uint16)", underlyingToken, underlyingUnits, 0);

        return (address(_aaveLendingPool), value, callData);
    }

    /**
     * @dev Generates the calldata to unwrap a wrapped asset into its underlying.
     *
     * @param underlyingToken      Address of the underlying asset
     * @param wrappedToken         Address of the component to be unwrapped
     * @param wrappedTokenUnits    Total quantity of wrapped token units to unwrap
     *
     * @return address             Target contract address
     * @return uint256             Total quantity of wrapped token units to unwrap. This will always be 0 for unwrapping
     * @return bytes               Unwrap calldata
     */
    function getUnwrapCallData(
        address underlyingToken,
        address wrappedToken,
        uint256 wrappedTokenUnits
    )
        external
        view
        onlyValidTokenPair(underlyingToken, wrappedToken)
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // redeem(uint256 _amount)
        bytes memory callData = abi.encodeWithSignature("redeem(uint256)", wrappedTokenUnits);

        return (address(wrappedToken), 0, callData);
    }

    /**
     * @dev Returns the address to approve source tokens for wrapping. This is the Aave Lending Pool Core
     *
     * @return address    Address of the contract to approve tokens to
     */
    function getSpenderAddress(
        address, /* underlyingToken */
        address /* wrappedToken */
    ) external view returns (address) {
        return address(_aaveLendingPoolCore);
    }

    // ==================== Private functions ====================

    /**
     * Validates the underlying and wrapped token pair
     *
     * @param underlyingToken    Address of the underlying asset
     * @param wrappedToken       Address of the wrapped asset
     */
    function _onlyValidTokenPair(address underlyingToken, address wrappedToken) private view {
        address aToken = _aaveLendingPoolCore.getReserveATokenAddress(underlyingToken);
        require(aToken == wrappedToken, "AWA0"); // Must be a valid token pair"
    }
}
