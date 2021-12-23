// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";

import { IUniswapV2Factory } from "../interfaces/external/uniswap-v2/IUniswapV2Factory.sol";
import { IUniswapV2Router02 } from "../interfaces/external/uniswap-v2/IUniswapV2Router02.sol";

/**
 * @title AmmSplitter
 *
 * @dev Peripheral contract which splits trades efficiently between Uniswap V2 and Sushiswap. Works for both exact input
 * and exact output trades. This contract adheres to the IUniswapV2Router02 interface, so it can work with existing contracts that
 * expect the Uniswap router. All math for calculating the optimal split is performed on-chain. This contract only supports
 * trade paths a max length of three because with two hops, we have a common unit (the middle token), to measure the pool sizes in.
 * Additionally, the math to calculate the optimal split for greater than two hops becomes increasingly complex.
 */
contract AmmSplitter {
    using SafeERC20 for IERC20;
    using PreciseUnitMath for uint256;

    // ==================== Structs ====================

    struct TradeInfo {
        uint256 uniSize; // Uniswap trade size (can be either input or output depending on context)
        uint256 sushiSize; // Sushiswap trade size (can be either input or output depending on context)
    }

    // ==================== Variables ====================

    IUniswapV2Router02 public immutable _uniRouter; // address of the Uniswap Router contract
    IUniswapV2Router02 public immutable _sushiRouter; // address of the Sushiswap Router contract
    IUniswapV2Factory public immutable _uniFactory; // address of the Uniswap Factory contract
    IUniswapV2Factory public immutable _sushiFactory; // address of the Sushiswap Factory contract

    // ==================== Events ====================

    event ExecuteTradeExactInput(
        address indexed sendToken,
        address indexed receiveToken,
        address indexed to,
        uint256 amountIn,
        uint256 amountOut,
        uint256 uniTradeSize,
        uint256 sushiTradeSize
    );

    event ExecuteTradeExactOutput(
        address indexed sendToken,
        address indexed receiveToken,
        address indexed to,
        uint256 amountIn,
        uint256 amountOut,
        uint256 uniTradeSize,
        uint256 sushiTradeSize
    );

    // ==================== Constructor function ====================

    constructor(
        IUniswapV2Router02 uniRouter,
        IUniswapV2Router02 sushiRouter,
        IUniswapV2Factory uniFactory,
        IUniswapV2Factory sushiFactory
    ) {
        _uniRouter = uniRouter;
        _sushiRouter = sushiRouter;
        _uniFactory = uniFactory;
        _sushiFactory = sushiFactory;
    }

    // ==================== External functions ====================

    /**
     * @dev Returns a quote with an estimated trade output amount
     *
     * @param amountIn      input amount
     * @param path          the trade path to use
     *
     * @return uint256[]    array of input amounts, intermediary amounts, and output amounts
     */
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory) {
        return _getAmounts(amountIn, path, true);
    }

    /**
     * @dev Returns a quote with an estimated trade input amount
     *
     * @param amountOut    output amount
     * @param path         the trade path to use
     *
     * @return uint256[]    array of input amounts, intermediary amounts, and output amounts
     */
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory) {
        return _getAmounts(amountOut, path, false);
    }

    /**
     * @dev Executes an exact input trade split between Uniswap and Sushiswap. This function is for when one wants to trade with the optimal split between Uniswap
     * and Sushiswap. This function's interface matches the Uniswap V2 swapExactTokensForTokens function. Input/output tokens are inferred implicitly from
     * the trade path with first token as input and last as output.
     *
     * @param amountIn        the exact input amount
     * @param amountOutMin    the minimum output amount that must be received
     * @param path            the path to use for the trade (length must be 3 or less so we can measure the pool size in units of the middle token for 2 hops)
     * @param to              the address to direct the outputs to
     * @param deadline        the deadline for the trade
     *
     * @return totalOutput    the actual output amount
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256 totalOutput) {
        _checkPath(path);

        IERC20 inputToken = IERC20(path[0]);
        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);

        TradeInfo memory tradeInfo = _getTradeSizes(path, amountIn);
        _checkApprovals(tradeInfo.uniSize, tradeInfo.sushiSize, inputToken);

        uint256 uniOutput = _executeTrade(_uniRouter, tradeInfo.uniSize, path, to, deadline, true);
        uint256 sushiOutput = _executeTrade(_sushiRouter, tradeInfo.sushiSize, path, to, deadline, true);

        totalOutput = uniOutput + sushiOutput;
        require(totalOutput >= amountOutMin, "AMMS0");

        emit ExecuteTradeExactInput(path[0], path[path.length - 1], to, amountIn, totalOutput, tradeInfo.uniSize, tradeInfo.sushiSize);
    }

    /**
     * @dev Executes an exact output trade split between Uniswap and Sushiswap. This function is for when one wants to trade with the optimal split between Uniswap
     * and Sushiswap. This function's interface matches the Uniswap V2 swapTokensForExactTokens function. Input/output tokens are inferred implicitly from
     * the trade path with first token as input and last as output.
     *
     * @param amountOut      the exact output amount
     * @param amountInMax    the maximum input amount that can be spent
     * @param path           the path to use for the trade (length must be 3 or less so we can measure the pool size in units of the middle token for 2 hops)
     * @param to             the address to direct the outputs to
     * @param deadline       the deadline for the trade
     *
     * @return totalInput    the actual input amount
     */
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256 totalInput) {
        _checkPath(path);

        TradeInfo memory tradeInfo = _getTradeSizes(path, amountOut);

        uint256 expectedUniInput = _getTradeInputOrOutput(_uniRouter, tradeInfo.uniSize, path, false)[0];
        uint256 expectedSushiInput = _getTradeInputOrOutput(_sushiRouter, tradeInfo.sushiSize, path, false)[0];
        totalInput = expectedUniInput + expectedSushiInput;

        // expected inputs are guaranteed to equal the actual inputs so we can revert early and save gas
        require(totalInput <= amountInMax, "AMMS1");

        IERC20 inputToken = IERC20(path[0]);
        inputToken.safeTransferFrom(msg.sender, address(this), totalInput);

        _checkApprovals(expectedUniInput, expectedSushiInput, inputToken);

        // total trade inputs here are guaranteed to equal totalInput calculated above so no check needed
        _executeTrade(_uniRouter, tradeInfo.uniSize, path, to, deadline, false);
        _executeTrade(_sushiRouter, tradeInfo.sushiSize, path, to, deadline, false);

        emit ExecuteTradeExactOutput(path[0], path[path.length - 1], to, totalInput, amountOut, tradeInfo.uniSize, tradeInfo.sushiSize);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Helper function for getting trade quotes
     *
     * @param size            input or output amount depending on isExactInput
     * @param path            trade path to use
     * @param isExactInput    whether an exact input or an exact output trade quote is needed
     *
     * @return amounts        array of input amounts, intermediary amounts, and output amounts
     */
    function _getAmounts(
        uint256 size,
        address[] calldata path,
        bool isExactInput
    ) internal view returns (uint256[] memory amounts) {
        _checkPath(path);

        TradeInfo memory tradeInfo = _getTradeSizes(path, size);
        uint256[] memory uniTradeResults = _getTradeInputOrOutput(_uniRouter, tradeInfo.uniSize, path, isExactInput);
        uint256[] memory sushiTradeResults = _getTradeInputOrOutput(_sushiRouter, tradeInfo.sushiSize, path, isExactInput);

        amounts = new uint256[](path.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            amounts[i] = uniTradeResults[i] + sushiTradeResults[i];
        }
    }

    /**
     * @dev Calculates the optimal trade sizes for Uniswap and Sushiswap. Pool values must be measured in the same token. For single hop trades
     * this is the balance of the output token. For two hop trades, it is measured as the balance of the intermediary token. The equation to
     * calculate the ratio for two hop trades is documented under _calculateTwoHopRatio. For single hop trades, this equation is:
     *
     * Tu/Ts = Pu / Ps
     *
     * Tu = Uniswap trade size
     * Ts = Sushiswap trade size
     * Pu = Uniswap pool size
     * Ps = Sushiswap pool size
     *
     * @param path          the trade path that will be used
     * @param size          the total size of the trade
     *
     * @return tradeInfo    TradeInfo struct containing Uniswap and Sushiswap trade sizes
     */
    function _getTradeSizes(address[] calldata path, uint256 size) internal view returns (TradeInfo memory tradeInfo) {
        uint256 uniPercentage;
        if (path.length == 2) {
            uint256 uniLiqPool = _getTokenBalanceInPair(_uniFactory, path[0], path[1]);
            uint256 sushiLiqPool = _getTokenBalanceInPair(_sushiFactory, path[0], path[1]);

            uniPercentage = uniLiqPool.preciseDiv(uniLiqPool + sushiLiqPool);
        } else {
            // always get the amount of the intermediate asset, so we have value measured in the same units for both pool A and B
            uint256 uniLiqPoolA = _getTokenBalanceInPair(_uniFactory, path[0], path[1]);
            uint256 uniLiqPoolB = _getTokenBalanceInPair(_uniFactory, path[2], path[1]);

            // returning early here saves gas and prevents division by zero errors later on
            if (uniLiqPoolA == 0 || uniLiqPoolB == 0) {
                return TradeInfo({ uniSize: 0, sushiSize: size });
            }

            // always get the amount of the intermediate asset, so we have value measured in the same units for both pool A and B
            uint256 sushiLiqPoolA = _getTokenBalanceInPair(_sushiFactory, path[0], path[1]);
            uint256 sushiLiqPoolB = _getTokenBalanceInPair(_sushiFactory, path[2], path[1]);

            // returning early here saves gas and prevents division by zero errors later on
            if (sushiLiqPoolA == 0 || sushiLiqPoolB == 0) {
                return TradeInfo({ uniSize: size, sushiSize: 0 });
            }

            uint256 ratio = _calculateTwoHopRatio(uniLiqPoolA, uniLiqPoolB, sushiLiqPoolA, sushiLiqPoolB);

            // to go from a ratio to percentage we must calculate: ratio / (ratio + 1). This percentage is measured in precise units
            uniPercentage = ratio.preciseDiv(ratio + PreciseUnitMath.PRECISE_UNIT);
        }

        tradeInfo.uniSize = size.preciseMul(uniPercentage);
        tradeInfo.sushiSize = size - tradeInfo.uniSize;
    }

    /**
     * @dev Calculates the optimal ratio of Uniswap trade size to Sushiswap trade size. To calculate the ratio between Uniswap
     * and Sushiswap use:
     *
     * Tu/Ts = ((Psa + Psb) * Pua * Pub) / ((Pua + Pub) * Psa * Psb)
     *
     * Tu  = Uniswap trade size
     * Ts  = Sushiswap trade size
     * Pua = Uniswap liquidity for pool A
     * Pub = Uniswap liquidity for pool B
     * Psa = Sushiswap liquidity for pool A
     * Psb = Sushiswap liquidity for pool B
     *
     * This equation is derived using several assumptions. First, it assumes that the price impact is equal to 2T / P where T is
     * equal to the trade size, and P is equal to the pool size. This approximation holds given that the price impact is a small percentage.
     * The second approximation made is that when executing trades that utilize multiple hops, total price impact is the sum of each
     * hop's price impact (not accounting for the price impact of the prior trade). This approximation again holds true under the assumption
     * that the total price impact is a small percentage. The full derivation of this equation can be viewed in STIP-002.
     *
     * @param uniLiqPoolA      Size of the first Uniswap pool
     * @param uniLiqPoolB      Size of the second Uniswap pool
     * @param sushiLiqPoolA    Size of the first Sushiswap pool
     * @param sushiLiqPoolB    Size of the second Sushiswap pool
     *
     * @return uint256         the ratio of Uniswap trade size to Sushiswap trade size
     */
    function _calculateTwoHopRatio(
        uint256 uniLiqPoolA,
        uint256 uniLiqPoolB,
        uint256 sushiLiqPoolA,
        uint256 sushiLiqPoolB
    ) internal pure returns (uint256) {
        uint256 a = (sushiLiqPoolA + sushiLiqPoolB).preciseDiv(uniLiqPoolA + uniLiqPoolB);
        uint256 b = uniLiqPoolA.preciseDiv(sushiLiqPoolA);
        uint256 c = uniLiqPoolB.preciseDiv(sushiLiqPoolB);

        return a.preciseMul(b).preciseMul(c);
    }

    /**
     * @dev Checks the token approvals to the Uniswap and Sushiswap routers are sufficient. If not it bumps the allowance to MAX_UINT_256.
     *
     * @param uniAmount      Uniswap input amount
     * @param sushiAmount    Sushiswap input amount
     * @param token          Token being traded
     */
    function _checkApprovals(
        uint256 uniAmount,
        uint256 sushiAmount,
        IERC20 token
    ) internal {
        if (token.allowance(address(this), address(_uniRouter)) < uniAmount) {
            token.approve(address(_uniRouter), PreciseUnitMath.MAX_UINT_256);
        }

        if (token.allowance(address(this), address(_sushiRouter)) < sushiAmount) {
            token.approve(address(_sushiRouter), PreciseUnitMath.MAX_UINT_256);
        }
    }

    /**
     * @dev Confirms that the path length is either two or three. Reverts if it does not fall within these bounds. When paths are greater than
     * three in length, the calculation for the optimal split between Uniswap and Sushiswap becomes much more difficult, so it is disallowed.
     *
     * @param path    trade path to check
     */
    function _checkPath(address[] calldata path) internal pure {
        require(path.length == 2 || path.length == 3, "AMMS2");
    }

    /**
     * @dev Gets the balance of a component token in a Uniswap / Sushiswap pool
     *
     * @param factory         factory contract to use (either _uniFactory or _sushiFactory)
     * @param pairedToken     first token in pair
     * @param balanceToken    second token in pair, and token to get balance of
     *
     * @return uint256        balance of second token in pair
     */
    function _getTokenBalanceInPair(
        IUniswapV2Factory factory,
        address pairedToken,
        address balanceToken
    ) internal view returns (uint256) {
        address uniPair = factory.getPair(pairedToken, balanceToken);
        return IERC20(balanceToken).balanceOf(uniPair);
    }

    /**
     * Executes a trade on Uniswap or Sushiswap. If passed a trade size of 0, skip the
     * trade.
     *
     * @param router          The router to execute the trade through (either Uniswap or Sushiswap)
     * @param size            Input amount if isExactInput is true, output amount if false
     * @param path            Path for the trade
     * @param to              Address to redirect trade output to
     * @param deadline        Timestamp that trade must execute before
     * @param isExactInput    Whether to perform an exact input or exact output swap
     *
     * @return uint256        the actual input / output amount of the trade
     */
    function _executeTrade(
        IUniswapV2Router02 router,
        uint256 size,
        address[] calldata path,
        address to,
        uint256 deadline,
        bool isExactInput
    ) internal returns (uint256) {
        if (size == 0) {
            return 0;
        }

        // maxInput or minOutput not checked here. The sum all inputs/outputs is instead checked after all trades execute
        if (isExactInput) {
            return router.swapExactTokensForTokens(size, 0, path, to, deadline)[path.length - 1];
        } else {
            return router.swapTokensForExactTokens(size, type(uint256).max, path, to, deadline)[0];
        }
    }

    /**
     * @dev Gets a trade quote on Uniswap or Sushiswap
     *
     * @param router          The router to get the quote from (either Uniswap or Sushiswap)
     * @param size            Input amount if isExactInput is true, output amount if false
     * @param path            Path for the trade
     * @param isExactInput    Whether to get a getAmountsIn or getAmountsOut quote
     *
     * @return uint256[]      Array of input amounts, intermediary amounts, and output amounts
     */
    function _getTradeInputOrOutput(
        IUniswapV2Router02 router,
        uint256 size,
        address[] calldata path,
        bool isExactInput
    ) internal view returns (uint256[] memory) {
        // if trade size is zero return an array of all zeros to prevent a revert
        if (size == 0) {
            return new uint256[](path.length);
        }

        if (isExactInput) {
            return router.getAmountsOut(size, path);
        } else {
            return router.getAmountsIn(size, path);
        }
    }
}
