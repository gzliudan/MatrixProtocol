// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title PositionUtil
 *
 * @dev Collection of helper functions for handling and updating MatrixToken Positions.
 */
library PositionUtil {
    using SafeCast for uint256;
    using SafeCast for int256;
    using PreciseUnitMath for uint256;

    // ==================== Internal functions ====================

    /**
     * @return Whether the MatrixToken has a default position for a given component (if the real unit is > 0)
     */
    function hasDefaultPosition(IMatrixToken matrixToken, address component) internal view returns (bool) {
        return matrixToken.getDefaultPositionRealUnit(component) > 0;
    }

    /**
     * @return Whether the MatrixToken has an external position for a given component (if # of position modules is > 0)
     */
    function hasExternalPosition(IMatrixToken matrixToken, address component) internal view returns (bool) {
        return matrixToken.getExternalPositionModules(component).length > 0;
    }

    /**
     * @return Whether the MatrixToken component default position real unit is greater than or equal to units passed in.
     */
    function hasSufficientDefaultUnits(
        IMatrixToken matrixToken,
        address component,
        uint256 unit
    ) internal view returns (bool) {
        return matrixToken.getDefaultPositionRealUnit(component) >= unit.toInt256();
    }

    /**
     * @return Whether the MatrixToken component external position is greater than or equal to the real units passed in.
     */
    function hasSufficientExternalUnits(
        IMatrixToken matrixToken,
        address component,
        address positionModule,
        uint256 unit
    ) internal view returns (bool) {
        return matrixToken.getExternalPositionRealUnit(component, positionModule) >= unit.toInt256();
    }

    /**
     * @dev If the position does not exist, create a new Position and add to the MatrixToken. If it already exists,
     * then set the position units. If the new units is 0, remove the position. Handles adding/removing of
     * components where needed (in light of potential external positions).
     *
     * @param matrixToken    Address of MatrixToken being modified
     * @param component      Address of the component
     * @param newUnit        Quantity of Position units - must be >= 0
     */
    function editDefaultPosition(
        IMatrixToken matrixToken,
        address component,
        uint256 newUnit
    ) internal {
        bool isPositionFound = hasDefaultPosition(matrixToken, component);
        if (!isPositionFound && newUnit > 0) {
            // If there is no Default Position and no External Modules, then component does not exist
            if (!hasExternalPosition(matrixToken, component)) {
                matrixToken.addComponent(component);
            }
        } else if (isPositionFound && newUnit == 0) {
            // If there is a Default Position and no external positions, remove the component
            if (!hasExternalPosition(matrixToken, component)) {
                matrixToken.removeComponent(component);
            }
        }

        matrixToken.editDefaultPositionUnit(component, newUnit.toInt256());
    }

    /**
     * @dev Update an external position and remove and external positions or components if necessary. The logic flows as follows:
     * 1) If component is not already added then add component and external position.
     * 2) If component is added but no existing external position using the passed module exists then add the external position.
     * 3) If the existing position is being added to then just update the unit and data
     * 4) If the position is being closed and no other external positions or default positions are associated with the component then untrack the component and remove external position.
     * 5) If the position is being closed and other existing positions still exist for the component then just remove the external position.
     *
     * @param matrixToken    MatrixToken being updated
     * @param component      Component position being updated
     * @param module         Module external position is associated with
     * @param newUnit        Position units of new external position
     * @param data           Arbitrary data associated with the position
     */
    function editExternalPosition(
        IMatrixToken matrixToken,
        address component,
        address module,
        int256 newUnit,
        bytes memory data
    ) internal {
        if (newUnit != 0) {
            if (!matrixToken.isComponent(component)) {
                matrixToken.addComponent(component);
                matrixToken.addExternalPositionModule(component, module);
            } else if (!matrixToken.isExternalPositionModule(component, module)) {
                matrixToken.addExternalPositionModule(component, module);
            }

            matrixToken.editExternalPositionUnit(component, module, newUnit);
            matrixToken.editExternalPositionData(component, module, data);
        } else {
            require(data.length == 0, "P0a"); // "Passed data must be null"

            // If no default or external position remaining then remove component from components array
            if (matrixToken.getExternalPositionRealUnit(component, module) != 0) {
                address[] memory positionModules = matrixToken.getExternalPositionModules(component);

                if (matrixToken.getDefaultPositionRealUnit(component) == 0 && positionModules.length == 1) {
                    require(positionModules[0] == module, "P0b"); // "External positions must be 0 to remove component")
                    matrixToken.removeComponent(component);
                }

                matrixToken.removeExternalPositionModule(component, module);
            }
        }
    }

    /**
     * @dev Get total notional amount of Default position
     *
     * @param matrixTokenSupply    Supply of MatrixToken in precise units (10^18)
     * @param positionUnit         Quantity of Position units
     *
     * @return uint256             Total notional amount of units
     */
    function getDefaultTotalNotional(uint256 matrixTokenSupply, uint256 positionUnit) internal pure returns (uint256) {
        return matrixTokenSupply.preciseMul(positionUnit);
    }

    /**
     * @dev Get position unit from total notional amount
     *
     * @param matrixTokenSupply    Supply of MatrixToken in precise units (10^18)
     * @param totalNotional        Total notional amount of component prior to
     *
     * @return uint256             Default position unit
     */
    function getDefaultPositionUnit(uint256 matrixTokenSupply, uint256 totalNotional) internal pure returns (uint256) {
        return totalNotional.preciseDiv(matrixTokenSupply);
    }

    /**
     * @dev Get the total tracked balance - total supply * position unit
     *
     * @param matrixToken    Address of the MatrixToken
     * @param component      Address of the component
     *
     * @return uint256       Notional tracked balance
     */
    function getDefaultTrackedBalance(IMatrixToken matrixToken, address component) internal view returns (uint256) {
        int256 positionUnit = matrixToken.getDefaultPositionRealUnit(component);

        return matrixToken.totalSupply().preciseMul(positionUnit.toUint256());
    }

    /**
     * @dev Calculates the new default position unit and performs the edit with the new unit
     *
     * @param matrixToken                 Address of the MatrixToken
     * @param component                   Address of the component
     * @param matrixTotalSupply           Current MatrixToken supply
     * @param componentPreviousBalance    Pre-action component balance
     *
     * @return uint256                    Current component balance
     * @return uint256                    Previous position unit
     * @return uint256                    New position unit
     */
    function calculateAndEditDefaultPosition(
        IMatrixToken matrixToken,
        address component,
        uint256 matrixTotalSupply,
        uint256 componentPreviousBalance
    )
        internal
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        uint256 currentBalance = IERC20(component).balanceOf(address(matrixToken));
        uint256 positionUnit = matrixToken.getDefaultPositionRealUnit(component).toUint256();

        uint256 newTokenUnit;
        if (currentBalance > 0) {
            newTokenUnit = calculateDefaultEditPositionUnit(matrixTotalSupply, componentPreviousBalance, currentBalance, positionUnit);
        } else {
            newTokenUnit = 0;
        }

        editDefaultPosition(matrixToken, component, newTokenUnit);

        return (currentBalance, positionUnit, newTokenUnit);
    }

    /**
     * @dev Calculate the new position unit given total notional values pre and post executing an action that changes MatrixToken state.
     * The intention is to make updates to the units without accidentally picking up airdropped assets as well.
     *
     * @param matrixTokenSupply    Supply of MatrixToken in precise units (10^18)
     * @param preTotalNotional     Total notional amount of component prior to executing action
     * @param postTotalNotional    Total notional amount of component after the executing action
     * @param prePositionUnit      Position unit of MatrixToken prior to executing action
     *
     * @return uint256             New position unit
     */
    function calculateDefaultEditPositionUnit(
        uint256 matrixTokenSupply,
        uint256 preTotalNotional,
        uint256 postTotalNotional,
        uint256 prePositionUnit
    ) internal pure returns (uint256) {
        // If pre action total notional amount is greater then subtract post action total notional and calculate new position units
        uint256 airdroppedAmount = preTotalNotional - prePositionUnit.preciseMul(matrixTokenSupply);

        return (postTotalNotional - airdroppedAmount).preciseDiv(matrixTokenSupply);
    }
}
