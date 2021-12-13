// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PositionUtil } from "./lib/PositionUtil.sol";
import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";

import { IController } from "../interfaces/IController.sol";
import { IMatrixToken } from "../interfaces/IMatrixToken.sol";
import { IPriceOracle } from "../interfaces/IPriceOracle.sol";

/**
 * @title MatrixValuer
 *
 * @dev Returns the valuation of MatrixTokens using price oracle data used in contracts that are external to the system.
 * @notice Prices are returned in preciseUnits (i.e. 18 decimals of precision)
 */
contract MatrixValuer {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== Variables ====================

    IController internal immutable _controller;

    // ==================== Constructor function ====================

    constructor(IController controller) {
        _controller = controller;
    }

    // ==================== External functions ====================

    function getController() external view returns (address) {
        return address(_controller);
    }

    /**
     * @dev Gets the valuation of a MatrixToken using data from the price oracle.
     * Reverts if no price exists for a component in the MatrixToken.
     * this works for external positions and negative (debt) positions.
     *
     * @notice There is a risk that the valuation is off if airdrops aren't retrieved
     * or debt builds up via interest and its not reflected in the position
     *
     * @param matrixToken    MatrixToken instance to get valuation
     * @param quoteAsset     Address of token to quote valuation in
     *
     * @return uint256       MatrixToken valuation in terms of quote asset in precise units 1e18
     */
    function calculateMatrixTokenValuation(IMatrixToken matrixToken, address quoteAsset) external view returns (uint256) {
        IPriceOracle priceOracle = _controller.getPriceOracle();
        address masterQuoteAsset = priceOracle.getMasterQuoteAsset();
        address[] memory components = matrixToken.getComponents();

        int256 valuation;
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            // Get component price from price oracle. If price does not exist, revert.
            uint256 componentPrice = priceOracle.getPrice(component, masterQuoteAsset);

            int256 aggregateUnits = matrixToken.getTotalComponentRealUnits(component);

            // Normalize each position unit to preciseUnits 1e18 and cast to signed int
            uint256 unitDecimals = ERC20(component).decimals();
            uint256 baseUnits = 10**unitDecimals;
            int256 normalizedUnits = aggregateUnits.preciseDiv(baseUnits.toInt256());

            // Calculate valuation of the component. Debt positions are effectively subtracted
            valuation += normalizedUnits.preciseMul(componentPrice.toInt256());
        }

        if (masterQuoteAsset != quoteAsset) {
            uint256 quoteToMaster = priceOracle.getPrice(quoteAsset, masterQuoteAsset);
            valuation = valuation.preciseDiv(quoteToMaster.toInt256());
        }

        return valuation.toUint256();
    }
}
