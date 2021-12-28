// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../../lib/AddressArrayUtil.sol";

import { IPriceOracle } from "../../../interfaces/IPriceOracle.sol";
import { IOracleAdapter } from "../../../interfaces/IOracleAdapter.sol";
import { IUniswapV2Pair } from "../../../interfaces/external/uniswap-v2/IUniswapV2Pair.sol";

contract UniswapV2PairPriceAdapter is AccessControl, IOracleAdapter {
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Structs ====================

    /**
     * Struct containing information for get price function
     */
    struct PoolSetting {
        uint256 token1BaseUnit; // Token one base unit. E.g. ETH is 10e18, USDC is 10e6
        uint256 token2BaseUnit; // Token two base unit.
        address token1; // Address of first token in reserve
        address token2; // Address of second token in reserve
        bool isValid; // Boolean that returns if Uniswap pool is allowed
    }

    // ==================== Variables ====================

    IPriceOracle internal immutable _priceOracle;

    address[] internal _quoteAssets;

    address[] internal _allowedUniswapPools;

    // Uniswap V2 pool address => PoolSetting
    mapping(address => PoolSetting) internal _poolSettings;

    // ==================== Constructor function ====================

    /**
     * @param priceOracle    Instance of PriceOracle contract
     */
    constructor(IPriceOracle priceOracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _priceOracle = priceOracle;
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function getPriceOracle() external view returns (IPriceOracle) {
        return _priceOracle;
    }

    function getQuoteAssets() external view returns (address[] memory) {
        return _quoteAssets;
    }

    function getQuoteAsset(uint256 index) external view returns (address) {
        return _quoteAssets[index];
    }

    function getAllowedUniswapPools() external view returns (address[] memory) {
        return _allowedUniswapPools;
    }

    function getUniswapPoolSetting(address pool) external view returns (PoolSetting memory) {
        return _poolSettings[pool];
    }

    /**
     *  @dev This function will revert if price not exist or both assets are not uniswap pool.
     */
    function getPriceByQuoteAsset(
        address asset1,
        address asset2,
        address quote
    ) external view returns (bool found, uint256 price) {
        bool isPool1Valid = _poolSettings[asset1].isValid;
        bool isPool2Valid = _poolSettings[asset2].isValid;

        if (isPool1Valid || isPool2Valid) {
            IPriceOracle priceOracle = _priceOracle; // for save gas
            uint256 price1 = isPool1Valid ? _getUniswapPairPrice(priceOracle, asset1, quote) : priceOracle.getPrice(asset1, quote);
            uint256 price2 = isPool2Valid ? _getUniswapPairPrice(priceOracle, asset2, quote) : priceOracle.getPrice(asset2, quote);

            return (true, price1.preciseDiv(price2));
        }
    }

    /**
     * @dev Calculate price from Uniswap. If both assets are not uniswap pool, return false.
     *
     * @param asset1    Address of first asset in pair
     * @param asset2    Address of second asset in pair
     */
    function getPrice(address asset1, address asset2) external view returns (bool found, uint256 price) {
        for (uint256 i = 0; i < _quoteAssets.length; i++) {
            try this.getPriceByQuoteAsset(asset1, asset2, _quoteAssets[i]) returns (bool found_, uint256 price_) {
                if (found_) {
                    return (true, price_);
                }
            } catch {}
        }
    }

    function addPool(address uniswapPool) external onlyAdmin {
        _addPool(uniswapPool);
    }

    function addPools(address[] calldata uniswapPools) external onlyAdmin {
        for (uint256 i = 0; i < uniswapPools.length; i++) {
            _addPool(uniswapPools[i]);
        }
    }

    function removePool(address uniswapPool) external onlyAdmin {
        _removePool(uniswapPool);
    }

    function removePools(address[] calldata uniswapPools) external onlyAdmin {
        for (uint256 i = 0; i < uniswapPools.length; i++) {
            _removePool(uniswapPools[i]);
        }
    }

    function addQuoteAsset(address quoteAsset) external onlyAdmin {
        require(!_quoteAssets.contain(quoteAsset), "UPPA0"); // "add already exist quote asset"

        _quoteAssets.push(quoteAsset);
    }

    function removeQuoteAsset(address quoteAsset) external onlyAdmin {
        require(_quoteAssets.contain(quoteAsset), "UPPA1"); // "remove nonexist quote asset"

        _quoteAssets.quickRemoveItem(quoteAsset);
    }

    // ==================== Internal functions ====================

    function _getUniswapPairPrice(
        IPriceOracle priceOracle,
        address uniswapPool,
        address quoteAsset
    ) internal view returns (uint256) {
        PoolSetting memory poolInfo = _poolSettings[uniswapPool];

        // Get prices against master quote asset. Note: if prices do not exist, function will revert
        uint256 token1Price = priceOracle.getPrice(poolInfo.token1, quoteAsset);
        uint256 token2Price = priceOracle.getPrice(poolInfo.token2, quoteAsset);

        // Get reserve amounts
        (uint256 token1Reserves, uint256 token2Reserves, ) = IUniswapV2Pair(uniswapPool).getReserves();

        uint256 normalizedToken1BaseUnits = token1Reserves.preciseDiv(poolInfo.token1BaseUnit);
        uint256 normalizedToken2BaseUnits = token2Reserves.preciseDiv(poolInfo.token2BaseUnit);
        uint256 totalNotionalToMaster = normalizedToken1BaseUnits.preciseMul(token1Price) + normalizedToken2BaseUnits.preciseMul(token2Price);

        return totalNotionalToMaster.preciseDiv(IUniswapV2Pair(uniswapPool).totalSupply());
    }

    function _addPool(address uniswapPool) internal {
        require(!_poolSettings[uniswapPool].isValid, "UPPA2"); // "Uniswap pool address already added"

        PoolSetting memory poolSetting;

        poolSetting.token1 = IUniswapV2Pair(uniswapPool).token0();
        uint256 token1Decimals = ERC20(poolSetting.token1).decimals();
        poolSetting.token1BaseUnit = 10**token1Decimals;

        poolSetting.token2 = IUniswapV2Pair(uniswapPool).token1();
        uint256 token2Decimals = ERC20(poolSetting.token2).decimals();
        poolSetting.token2BaseUnit = 10**token2Decimals;

        poolSetting.isValid = true;

        _allowedUniswapPools.push(uniswapPool);
        _poolSettings[uniswapPool] = poolSetting;
    }

    function _removePool(address uniswapPool) internal {
        require(_poolSettings[uniswapPool].isValid, "UPPA3"); // "Uniswap pool address does not exist"

        _allowedUniswapPools.quickRemoveItem(uniswapPool);
        delete _poolSettings[uniswapPool];
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "UPPA4");
    }
}
