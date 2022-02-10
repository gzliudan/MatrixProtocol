// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IDMMPool } from "../../../../interfaces/external/kyber/IDMMPool.sol";
import { IDMMFactory } from "../../../../interfaces/external/kyber/IDMMFactory.sol";
import { IDMMRouter02 } from "../../../../interfaces/external/kyber/IDMMRouter02.sol";

import { IExchangeAdapter } from "../../../../interfaces/IExchangeAdapter.sol";

/**
 * @title KyberV1ExchangeAdapterBase
 * @author Matrix
 */
abstract contract KyberV1ExchangeAdapterBase is IExchangeAdapter {
    // ==================== Variables ====================

    address internal immutable _factory; // KyberSwap v1 factory
    address internal immutable _router; // Address of KyberSwap V1 DMMRouter02

    // ==================== Constructor function ====================

    constructor(address router) {
        _factory = IDMMRouter02(router).factory();
        _router = router;
    }

    // ==================== External functions ====================

    /**
     * @dev Returns the KyberSwap factory address.
     */
    function getFactory() external view returns (address) {
        return _factory;
    }

    /**
     * @dev Returns the KyberSwap router address to approve source tokens for trading.
     */
    function getSpender() external view returns (address) {
        return _router;
    }

    // ==================== Internal functions ====================

    function _getBestPool(address token1, address token2) internal view returns (address bestPool) {
        address[] memory poolAddresses = IDMMFactory(_factory).getPools(IERC20(token1), IERC20(token2));
        require(poolAddresses.length > 0, "BKEA0");
        bestPool = poolAddresses[0];

        uint256 highestKLast = 0;
        for (uint256 i = 0; i < poolAddresses.length; i++) {
            uint256 currentKLast = IDMMPool(poolAddresses[i]).kLast();
            if (currentKLast > highestKLast) {
                highestKLast = currentKLast;
                bestPool = poolAddresses[i];
            }
        }
    }
}
