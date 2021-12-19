// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IAmmAdapter
 */
interface IAmmAdapter {
    // ==================== External functions ====================

    function getProvideLiquidityCalldata(address matrixToken, address pool, address[] calldata components,
        uint256[] calldata maxTokensIn, uint256 minLiquidity) external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore

    function getProvideLiquiditySingleAssetCalldata(address matrixToken, address pool, address component,
        uint256 maxTokenIn, uint256 minLiquidity) external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore

    function getRemoveLiquidityCalldata(address matrixToken, address pool, address[] calldata components,
        uint256[] calldata minTokensOut, uint256 liquidity) external view returns (address target, uint256 value, bytes memory callData); // prettier-ignore

    function getRemoveLiquiditySingleAssetCalldata(address matrixToken, address pool, address component,
        uint256 minTokenOut, uint256 liquidity) external view returns ( address target, uint256 value, bytes memory callData); // prettier-ignore

    function getSpenderAddress(address pool) external view returns (address);

    function isValidPool(address pool, address[] memory components) external view returns (bool);
}
