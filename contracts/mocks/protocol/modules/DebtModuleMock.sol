// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { IController } from "../../../interfaces/IController.sol";
import { IMatrixToken } from "../../../interfaces/IMatrixToken.sol";
import { IDebtIssuanceModule } from "../../../interfaces/IDebtIssuanceModule.sol";

import { ModuleBase } from "../../../protocol/lib/ModuleBase.sol";
import { PositionUtil } from "../../../protocol/lib/PositionUtil.sol";

/**
 * @title DebtModuleMock
 *
 * @dev Mock for modules that handle debt positions. Used for testing DebtIssuanceModule
 */
contract DebtModuleMock is ModuleBase {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== Variables ====================

    address internal _module;
    bool internal _moduleIssueHookCalled;
    bool internal _moduleRedeemHookCalled;
    mapping(address => int256) internal _equityIssuanceAdjustment;
    mapping(address => int256) internal _debtIssuanceAdjustment;

    // ==================== Constructor function ====================

    constructor(IController controller, address module) ModuleBase(controller) {
        _module = module;
    }

    // ==================== External functions ====================

    function getModule() external view returns (address) {
        return _module;
    }

    function isModuleIssueHookCalled() external view returns (bool) {
        return _moduleIssueHookCalled;
    }

    function isModuleRedeemHookCalled() external view returns (bool) {
        return _moduleRedeemHookCalled;
    }

    function getEquityIssuanceAdjustment(address addr) external view returns (int256) {
        return _equityIssuanceAdjustment[addr];
    }

    function addEquityIssuanceAdjustment(address token, int256 amount) external {
        _equityIssuanceAdjustment[token] = amount;
    }

    function getDebtIssuanceAdjustment(address addr) external view returns (int256) {
        return _debtIssuanceAdjustment[addr];
    }

    function addDebtIssuanceAdjustment(address token, int256 amount) external {
        _debtIssuanceAdjustment[token] = amount;
    }

    function addDebt(
        IMatrixToken matrixToken,
        address token,
        uint256 amount
    ) external {
        matrixToken.editExternalPosition(token, address(this), amount.toInt256() * -1, "");
    }

    function moduleIssueHook(
        IMatrixToken, /* matrixToken */
        uint256 /* matrixTokenQuantity */
    ) external {
        _moduleIssueHookCalled = true;
    }

    function moduleRedeemHook(
        IMatrixToken, /* matrixToken */
        uint256 /* matrixTokenQuantity */
    ) external {
        _moduleRedeemHookCalled = true;
    }

    function componentIssueHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        address component,
        bool /* _isEquity */
    ) external {
        uint256 unitAmount = (matrixToken.getExternalPositionRealUnit(component, address(this)) * -1).toUint256();
        uint256 notionalAmount = PositionUtil.getDefaultTotalNotional(matrixTokenQuantity, unitAmount);
        IERC20(component).transfer(address(matrixToken), notionalAmount);
    }

    function componentRedeemHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        address component,
        bool /* _isEquity */
    ) external {
        uint256 unitAmount = (matrixToken.getExternalPositionRealUnit(component, address(this)) * -1).toUint256();
        uint256 notionalAmount = PositionUtil.getDefaultTotalNotional(matrixTokenQuantity, unitAmount);
        matrixToken.invokeSafeTransfer(component, address(this), notionalAmount);
    }

    function getIssuanceAdjustments(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external view returns (int256[] memory, int256[] memory) {
        address[] memory components = matrixToken.getComponents();
        int256[] memory equityAdjustments = new int256[](components.length);
        int256[] memory debtAdjustments = new int256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            equityAdjustments[i] = _equityIssuanceAdjustment[components[i]];
            debtAdjustments[i] = _debtIssuanceAdjustment[components[i]];
        }

        return (equityAdjustments, debtAdjustments);
    }

    function getRedemptionAdjustments(
        IMatrixToken matrixToken,
        uint256 /* matrixTokenQuantity */
    ) external view returns (int256[] memory, int256[] memory) {
        address[] memory components = matrixToken.getComponents();
        int256[] memory equityAdjustments = new int256[](components.length);
        int256[] memory debtAdjustments = new int256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            equityAdjustments[i] = _equityIssuanceAdjustment[components[i]];
            debtAdjustments[i] = _debtIssuanceAdjustment[components[i]];
        }

        return (equityAdjustments, debtAdjustments);
    }

    function initialize(IMatrixToken matrixToken) external {
        matrixToken.initializeModule();
        IDebtIssuanceModule(_module).registerToIssuanceModule(matrixToken);
    }

    function removeModule() external override {
        IDebtIssuanceModule(_module).unregisterFromIssuanceModule(IMatrixToken(msg.sender));
    }
}
