// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

// ==================== Internal Imports ====================

import { IUniswapV2Pair } from "../../../interfaces/external/uniswap-v2/IUniswapV2Pair.sol";
import { IUniswapV2Factory } from "../../../interfaces/external/uniswap-v2/IUniswapV2Factory.sol";
import { IUniswapV2Router02 } from "../../../interfaces/external/uniswap-v2/IUniswapV2Router02.sol";

import { IAmmAdapter } from "../../../interfaces/IAmmAdapter.sol";

/**
 * @title UniswapV2AmmAdapter
 *
 * @dev Adapter for Uniswap V2 Router that encodes adding and removing liquidty
 */
contract UniswapV2AmmAdapter is IAmmAdapter {
    // ==================== Variables ====================

    // Address of Uniswap V2 Router contract
    address public immutable _router;

    IUniswapV2Factory public immutable _factory;

    // Internal function string for adding liquidity
    string internal constant ADD_LIQUIDITY = "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)";

    // Internal function string for removing liquidity
    string internal constant REMOVE_LIQUIDITY = "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)";

    // ==================== Constructor function ====================

    constructor(address router) {
        _router = router;
        _factory = IUniswapV2Factory(IUniswapV2Router02(router).factory());
    }

    // ==================== External functions ====================

    /**
     * @dev Return calldata for the add liquidity call
     *
     * @param matrixToken     Address of the MatrixToken
     * @param pool            Address of liquidity token
     * @param components      Address array required to add liquidity
     * @param maxTokensIn     AmountsIn desired to add liquidity
     * @param minLiquidity    Min liquidity amount to add
     */
    function getProvideLiquidityCalldata(
        address matrixToken,
        address pool,
        address[] calldata components,
        uint256[] calldata maxTokensIn,
        uint256 minLiquidity
    )
        external
        view
        override
        returns (
            address target,
            uint256 value,
            bytes memory data
        )
    {
        require(maxTokensIn[0] > 0 && maxTokensIn[1] > 0, "UbAA0");

        // We expect the totalSupply to be greater than 0 because the isValidPool would have passed by this point, meaning
        // a pool for these tokens exist, which also means there is at least MINIMUM_LIQUIDITY liquidity tokens in the pool
        // https://github.com/Uniswap/uniswap-v2-core/blob/master/contracts/UniswapV2Pair.sol#L121
        // If this is the case, we know the liquidity returned from the pool is equal to the minimum of the given supplied
        // token multiplied by the totalSupply of liquidity tokens divided by the pool reserves of that token.
        // https://github.com/Uniswap/uniswap-v2-core/blob/master/contracts/UniswapV2Pair.sol#L123

        (uint256 amountAMin, uint256 amountBMin) = _getMinAmounts(pool, components, maxTokensIn, minLiquidity);
        data = _encodeProvideLiquidityData(matrixToken, components, maxTokensIn, amountAMin, amountBMin);
        target = _router;
        value = 0;
    }

    /**
     * @dev Return calldata for the add liquidity call for a single asset
     */
    function getProvideLiquiditySingleAssetCalldata(
        address, /* matrixToken */
        address, /* pool */
        address, /* component */
        uint256, /* maxTokenIn */
        uint256 /* minLiquidity */
    )
        external
        pure
        override
        returns (
            address, /* target */
            uint256, /* value */
            bytes memory /* data */
        )
    {
        revert("UbAA1");
    }

    /**
     * Return calldata for the remove liquidity call
     *
     * @param matrixToken     Address of the MatrixToken
     * @param pool            Address of liquidity token
     * @param components      Address array required to remove liquidity
     * @param minTokensOut    AmountsOut minimum to remove liquidity
     * @param liquidity       Liquidity amount to remove
     */
    function getRemoveLiquidityCalldata(
        address matrixToken,
        address pool,
        address[] calldata components,
        uint256[] calldata minTokensOut,
        uint256 liquidity
    )
        external
        view
        override
        returns (
            address target,
            uint256 value,
            bytes memory data
        )
    {
        // Make sure that only up the amount of liquidity tokens owned by the Set Token are redeemed
        IUniswapV2Pair pair = IUniswapV2Pair(pool);
        uint256 matrixTokenLiquidityBalance = pair.balanceOf(matrixToken);
        require(liquidity <= matrixTokenLiquidityBalance, "UbAA2a");

        // scope for reserveA, reserveB, totalSupply, reservesOwnedByLiquidityA, and reservesOwnedByLiquidityB, avoids stack too deep errors
        {
            // For a given Uniswap V2 Liquidity Pool, an owner of a liquidity token is able to claim a portion of the reserves
            // of that pool based on the percentage of liquidity tokens that they own in relation to the total supply of the
            // liquidity tokens. So if a user owns 25% of the pool tokens, they would in effect own 25% of both reserveA and
            // reserveB contained within the pool. Therefore, given the value of _liquidity we can calculate how much of the
            // reserves the caller is requesting and can then validate that the _minTokensOut values are less than or equal to that amount.
            // If not, they are requesting too much of the components relative to the amount of liquidty that they are redeeming.
            uint256 totalSupply = pair.totalSupply();
            (uint256 reserveA, uint256 reserveB) = _getReserves(pair, components[0]);
            uint256 reservesOwnedByLiquidityA = (reserveA * liquidity) / totalSupply;
            uint256 reservesOwnedByLiquidityB = (reserveB * liquidity) / totalSupply;

            require(minTokensOut[0] <= reservesOwnedByLiquidityA && minTokensOut[1] <= reservesOwnedByLiquidityB, "UbAA2b");
        }

        data = _encodeRemoveLiquidityData(matrixToken, components, minTokensOut, liquidity);
        target = _router;
        value = 0;
    }

    /**
     * Return calldata for the remove liquidity single asset call
     */
    function getRemoveLiquiditySingleAssetCalldata(
        address, /* matrixToken */
        address, /* pool */
        address, /* component */
        uint256, /* minTokenOut */
        uint256 /* liquidity */
    )
        external
        pure
        override
        returns (
            address, /*target*/
            uint256, /*value*/
            bytes memory /*data*/
        )
    {
        revert("UbAA3");
    }

    /**
     * @dev Returns the address of the spender
     */
    function getSpenderAddress(
        address /* pool */
    ) external view override returns (address spender) {
        spender = _router;
    }

    /**
     * @dev Verifies that this is a valid Uniswap V2 pool
     *
     * @param pool          Address of liquidity token
     * @param components    Address array of supplied/requested tokens
     */
    function isValidPool(address pool, address[] memory components) external view override returns (bool) {
        IUniswapV2Factory poolFactory;

        // Attempt to get the factory of the provided pool
        try IUniswapV2Pair(pool).factory() returns (address factory_) {
            poolFactory = IUniswapV2Factory(factory_);
        } catch {
            return false;
        }

        // Make sure the pool factory is the expected value, that we have the two required components,
        // and that the pair address returned by the factory matches the supplied pool value
        if (_factory != poolFactory || components.length != 2 || _factory.getPair(components[0], components[1]) != pool) {
            return false;
        }

        return true;
    }

    // ==================== Internal functions ====================

    /**
     * @dev Returns the pair reserves in an expected order
     *
     * @param pair      The pair to get the reserves from
     * @param tokenA    Address of the token to swap
     */
    function _getReserves(IUniswapV2Pair pair, address tokenA) internal view returns (uint256 reserveA, uint256 reserveB) {
        address token0 = pair.token0();
        (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    // ==================== Private functions ====================

    // avoid CompilerError: Stack too deep, try removing local variables.
    function _getMinAmounts(
        address pool,
        address[] calldata components,
        uint256[] calldata maxTokensIn,
        uint256 minLiquidity
    ) private view returns (uint256 amountAMin, uint256 amountBMin) {
        IUniswapV2Pair pair = IUniswapV2Pair(pool);
        uint256 totalSupply = pair.totalSupply();
        (uint256 reserveA, uint256 reserveB) = _getReserves(pair, components[0]);
        uint256 liquidityExpectedFromSuppliedTokens = Math.min((maxTokensIn[0] * totalSupply) / reserveA, (maxTokensIn[1] * totalSupply) / reserveB);
        require(minLiquidity <= liquidityExpectedFromSuppliedTokens, "UbAA4");
        amountAMin = (liquidityExpectedFromSuppliedTokens * reserveA) / totalSupply;
        amountBMin = (liquidityExpectedFromSuppliedTokens * reserveB) / totalSupply;
    }

    // avoid CompilerError: Stack too deep, try removing local variables.
    function _encodeProvideLiquidityData(
        address matrixToken,
        address[] calldata components,
        uint256[] calldata maxTokensIn,
        uint256 amountAMin,
        uint256 amountBMin
    ) private view returns (bytes memory) {
        return
            abi.encodeWithSignature(
                ADD_LIQUIDITY,
                components[0],
                components[1],
                maxTokensIn[0],
                maxTokensIn[1],
                amountAMin,
                amountBMin,
                matrixToken,
                block.timestamp
            );
    }

    // avoid CompilerError: Stack too deep, try removing local variables.
    function _encodeRemoveLiquidityData(
        address matrixToken,
        address[] calldata components,
        uint256[] calldata minTokensOut,
        uint256 liquidity
    ) private view returns (bytes memory) {
        return
            abi.encodeWithSignature(REMOVE_LIQUIDITY, components[0], components[1], liquidity, minTokensOut[0], minTokensOut[1], matrixToken, block.timestamp);
    }
}
