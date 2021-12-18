// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WrapV2AdapterMock
 *
 * @dev ERC20 contract that doubles as a wrap token.
 * The wrapToken accepts any underlying token and mints/burns the WrapAdapter Token.
 */
contract WrapV2AdapterMock is ERC20 {
    // ==================== Constants ====================

    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ==================== Constructor function ====================

    constructor() ERC20("WrapV2Adapter", "WRAPV2") {}

    // ==================== External functions ====================

    /**
     * @dev Mints tokens to the sender of the underlying quantity
     */
    function deposit(address underlyingToken, uint256 underlyingQuantity) external payable {
        // Do a transferFrom of the underlyingToken
        if (underlyingToken != ETH_TOKEN_ADDRESS) {
            IERC20(underlyingToken).transferFrom(msg.sender, address(this), underlyingQuantity);
        }

        _mint(msg.sender, underlyingQuantity);
    }

    /**
     * @dev Burns tokens from the sender of the wrapped asset and returns the underlying
     */
    function withdraw(address underlyingToken, uint256 underlyingQuantity) external {
        // Transfer the underlying to the sender
        if (underlyingToken == ETH_TOKEN_ADDRESS) {
            payable(msg.sender).transfer(underlyingQuantity);
        } else {
            IERC20(underlyingToken).transfer(msg.sender, underlyingQuantity);
        }

        _burn(msg.sender, underlyingQuantity);
    }

    /**
     * @dev Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param underlyingToken    Address of the component to be wrapped
     * @param underlyingUnits    Total quantity of underlying units to wrap
     *
     * @return target            Target contract address
     * @return value             Total quantity of underlying units (if underlying is ETH)
     * @return callData          Wrap calldata
     */
    function getWrapCallData(
        address underlyingToken,
        address, /* wrappedToken */
        uint256 underlyingUnits,
        address, /* to */
        bytes memory /* wrapData */
    )
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        target = address(this);
        value = underlyingToken == ETH_TOKEN_ADDRESS ? underlyingUnits : 0;
        callData = abi.encodeWithSignature("deposit(address,uint256)", underlyingToken, underlyingUnits);
    }

    /**
     * Generates the calldata to unwrap a wrapped asset into its underlying.
     *
     * @param underlyingToken      Address of the underlying of the component to be unwrapped
     * @param wrappedTokenUnits    Total quantity of wrapped token units to unwrap
     *
     * @return target              Target contract address
     * @return value               Total quantity of wrapped token units to unwrap. This will always be 0 for unwrapping
     * @return callData            Unwrap calldata
     */
    function getUnwrapCallData(
        address underlyingToken,
        address, /* wrappedToken */
        uint256 wrappedTokenUnits,
        address, /* _to */
        bytes memory /* _wrapData */
    )
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = address(this);
        callData = abi.encodeWithSignature("withdraw(address,uint256)", underlyingToken, wrappedTokenUnits);
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
        return address(this);
    }
}
