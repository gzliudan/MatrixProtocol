// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";
import { IModuleIssuanceHook } from "../../../interfaces/IModuleIssuanceHook.sol";

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

import { PositionUtil } from "../../../protocol/lib/PositionUtil.sol";

/**
 * @title ModuleIssuanceHookMock
 */
contract ModuleIssuanceHookMock is IModuleIssuanceHook {
    using SafeCast for int256;
    using PreciseUnitMath for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== External functions ====================

    function initialize(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
    }

    function addExternalPosition(
        IMatrixToken matrixToken,
        address component,
        int256 quantity
    ) external {
        matrixToken.editExternalPosition(component, address(this), quantity, "");
    }

    function moduleIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external override {}

    function moduleRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external override {}

    function componentIssueHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external override {
        int256 externalPositionUnit = matrixToken.getExternalPositionRealUnit(address(component), address(this));
        uint256 totalNotionalExternalModule = matrixTokenQuantity.preciseMul(externalPositionUnit.toUint256());

        // Invoke the MatrixToken to send the token of total notional to this address
        matrixToken.invokeSafeTransfer(address(component), address(this), totalNotionalExternalModule);
    }

    function componentRedeemHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external override {
        // Send the component to the settoken
        int256 externalPositionUnit = matrixToken.getExternalPositionRealUnit(address(component), address(this));
        uint256 totalNotionalExternalModule = matrixTokenQuantity.preciseMul(externalPositionUnit.toUint256());
        component.transfer(address(matrixToken), totalNotionalExternalModule);
    }
}
