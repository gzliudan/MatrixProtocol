// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IExchange
 */
interface IExchange {
    struct FundingGrowth {
        int256 twPremiumX96;
        int256 twPremiumDivBySqrtPriceX96;
    }

    struct SwapParams {
        address trader;
        address baseToken;
        bool isBaseToQuote;
        bool isExactInput;
        uint256 amount;
        uint160 sqrtPriceLimitX96;
        FundingGrowth fundingGrowthGlobal;
    }

    struct SwapResponse {
        uint256 deltaAvailableBase;
        uint256 deltaAvailableQuote;
        int256 exchangedPositionSize;
        int256 exchangedPositionNotional;
        uint256 fee;
        uint256 insuranceFundFee;
        int24 tick;
        int256 realizedPnl;
        int256 openNotional;
    }

    // Note: Do *NOT* add `getFundingGrowthGlobalAndTwaps` to this interface. It may work with the
    // custom bytecode we generated to expose the method in our TS tests but it's no longer part of the
    // public interface of the deployed PerpV2 system contracts. (Removed in v0.15.0).

    function getPool(address baseToken) external view returns (address);

    function getTick(address baseToken) external view returns (int24);

    function getSqrtMarkTwapX96(address baseToken, uint32 twapInterval) external view returns (uint160);

    function getMaxTickCrossedWithinBlock(address baseToken) external view returns (uint24);

    function getAllPendingFundingPayment(address trader) external view returns (int256);

    function getPendingFundingPayment(address trader, address baseToken) external view returns (int256);
}
