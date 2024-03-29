// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title IMarketRegistry
 */
interface IMarketRegistry {
    // ==================== Structs ====================

    struct MarketInfo {
        address pool;
        uint24 exchangeFeeRatio;
        uint24 uniswapFeeRatio;
        uint24 insuranceFundFeeRatio;
    }

    // ==================== Events ====================

    event PoolAdded(address indexed baseToken, uint24 indexed feeRatio, address indexed pool);
    event FeeRatioChanged(address baseToken, uint24 feeRatio);
    event InsuranceFundFeeRatioChanged(uint24 feeRatio);
    event MaxOrdersPerMarketChanged(uint8 maxOrdersPerMarket);

    // ==================== External functions ====================

    function addPool(address baseToken, uint24 feeRatio) external returns (address);

    function setFeeRatio(address baseToken, uint24 feeRatio) external;

    function setInsuranceFundFeeRatio(address baseToken, uint24 insuranceFundFeeRatioArg) external;

    function setMaxOrdersPerMarket(uint8 maxOrdersPerMarketArg) external;

    function getPool(address baseToken) external view returns (address);

    function getFeeRatio(address baseToken) external view returns (uint24);

    function getInsuranceFundFeeRatio(address baseToken) external view returns (uint24);

    function getMarketInfo(address baseToken) external view returns (MarketInfo memory);

    function getQuoteToken() external view returns (address);

    function getUniswapV3Factory() external view returns (address);

    function getMaxOrdersPerMarket() external view returns (uint8);

    function hasPool(address baseToken) external view returns (bool);
}
