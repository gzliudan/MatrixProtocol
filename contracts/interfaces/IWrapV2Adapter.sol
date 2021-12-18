// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IWrapV2Adapter
 */
interface IWrapV2Adapter {
    // ==================== External functions ====================

    function ETH_TOKEN_ADDRESS() external view returns (address);

    function getWrapCallData( address underlyingToken, address wrappedToken, uint256 underlyingUnits, address to, bytes memory wrapData)
        external view returns (address subject, uint256 value, bytes memory callData); // prettier-ignore

    function getUnwrapCallData(address underlyingToken, address wrappedToken, uint256 wrappedTokenUnits, address to, bytes memory unwrapData)
        external view returns (address subject, uint256 value, bytes memory callData); // prettier-ignore

    function getSpenderAddress(address underlyingToken, address wrappedToken) external view returns (address);
}
