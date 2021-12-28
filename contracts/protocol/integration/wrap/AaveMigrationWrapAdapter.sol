// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title AaveMigrationWrapAdapter
 *
 * @dev Wrap adapter for one time token migration that returns data for wrapping LEND into AAVE
 */
contract AaveMigrationWrapAdapter {
    // ==================== Variables ====================

    // Address of Aave migration contract proxy
    address public immutable _lendToAaveMigrationProxy;

    // Address of LEND token
    address public immutable _lendToken;

    // Address of AAVE token
    address public immutable _aaveToken;

    // ==================== Constructor function ====================

    /**
     * @param lendToAaveMigrationProxy    Address of Aave migration contract proxy
     * @param lendToken                   Address of LEND token
     * @param aaveToken                   Address of AAVE token
     */
    constructor(
        address lendToAaveMigrationProxy,
        address lendToken,
        address aaveToken
    ) {
        _lendToAaveMigrationProxy = lendToAaveMigrationProxy;
        _lendToken = lendToken;
        _aaveToken = aaveToken;
    }

    // ==================== External functions ====================

    /**
     * @dev Generates the calldata to migrate LEND to AAVE.
     *
     * @param underlyingToken    Address of the component to be wrapped
     * @param wrappedToken       Address of the wrapped component
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
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        require(underlyingToken == _lendToken, "AMWA0a"); // Must be LEND token
        require(wrappedToken == _aaveToken, "AMWA0b"); // Must be AAVE token

        // migrateFromLEND(uint256 _amount)
        bytes memory callData = abi.encodeWithSignature("migrateFromLEND(uint256)", underlyingUnits);

        return (_lendToAaveMigrationProxy, 0, callData);
    }

    /**
     * @dev Generates the calldata to unwrap a wrapped asset into its underlying.
     * @notice Migration cannot be reversed. This function will revert.
     *
     * @return address    Target contract address
     * @return uint256    Total quantity of wrapped token units to unwrap. This will always be 0 for unwrapping
     * @return bytes      Unwrap calldata
     */
    function getUnwrapCallData(
        address, /* underlyingToken */
        address, /* wrappedToken */
        uint256 /* wrappedTokenUnits */
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // AAVE migration cannot be reversed
        revert("AMWA1");
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getSpenderAddress(
        address, /* underlyingToken */
        address /* wrappedToken */
    ) external view returns (address) {
        return _lendToAaveMigrationProxy;
    }
}
