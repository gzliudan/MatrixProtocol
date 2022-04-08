// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";
import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IManagerIssuanceHook } from "../../interfaces/IManagerIssuanceHook.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";

/**
 * @title IssuanceModule
 *
 * @dev The IssuanceModule is a module that enables users to issue and redeem MatrixTokens that contain default and
 * non-debt external Positions. Managers are able to set an external contract hook that is called before an issuance is called.
 */
contract IssuanceModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using ExactSafeErc20 for IERC20;
    using PreciseUnitMath for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== Variables ====================

    // IMatrixToken => issuance hook configurations
    mapping(IMatrixToken => IManagerIssuanceHook) internal _managerIssuanceHooks;

    // ==================== Events ====================

    event IssueMatrixToken(address indexed matrixToken, address issuer, address to, address hookContract, uint256 quantity);
    event RedeemMatrixToken(address indexed matrixToken, address redeemer, address to, uint256 quantity);

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== External functions ====================

    function getManagerIssuanceHook(IMatrixToken matrixToken) external view returns (IManagerIssuanceHook) {
        return _managerIssuanceHooks[matrixToken];
    }

    /**
     * @dev Deposits components to the MatrixToken and replicates any external module component positions and mints
     * the MatrixToken. Any issuances with MatrixToken that have external positions with negative unit will revert.
     *
     * @param matrixToken    Instance of the MatrixToken contract
     * @param quantity       Quantity of the MatrixToken to mint
     * @param to             Address to mint MatrixToken to
     */
    function issue(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "IM0"); // "Issue quantity must be > 0"

        address hookContract = _callPreIssueHooks(matrixToken, quantity, msg.sender, to);
        (address[] memory components, uint256[] memory componentQuantities) = getRequiredComponentIssuanceUnits(matrixToken, quantity, true);

        // For each position, transfer the required underlying to the MatrixToken and call external module hooks
        for (uint256 i = 0; i < components.length; i++) {
            IERC20(components[i]).exactSafeTransferFrom(msg.sender, address(matrixToken), componentQuantities[i]);
            _executeExternalPositionHooks(matrixToken, quantity, IERC20(components[i]), true);
        }

        matrixToken.mint(to, quantity);

        emit IssueMatrixToken(address(matrixToken), msg.sender, to, hookContract, quantity);
    }

    /**
     * @dev Burns a user's MatrixToken of specified quantity, unwinds external positions, and returns components
     * to the specified address. Does not work for debt/negative external positions.
     *
     * @param matrixToken    Instance of the MatrixToken contract
     * @param quantity       Quantity of the MatrixToken to redeem
     * @param to             Address to send component assets to
     */
    function redeem(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "IM1"); // "Redeem quantity must be > 0"

        matrixToken.burn(msg.sender, quantity);
        (address[] memory components, uint256[] memory componentQuantities) = getRequiredComponentIssuanceUnits(matrixToken, quantity, false);

        for (uint256 i = 0; i < components.length; i++) {
            _executeExternalPositionHooks(matrixToken, quantity, IERC20(components[i]), false);
            matrixToken.invokeExactSafeTransfer(components[i], to, componentQuantities[i]);
        }

        emit RedeemMatrixToken(address(matrixToken), msg.sender, to, quantity);
    }

    /**
     * @dev Initializes this module to the MatrixToken with issuance-related hooks. Only callable by the MatrixToken's manager.
     * Hook addresses are optional. Address(0) means that no hook will be called
     *
     * @param matrixToken     Instance of the MatrixToken to issue
     * @param preIssueHook    Instance of the Manager Contract with the Pre-Issuance Hook function
     */
    function initialize(IMatrixToken matrixToken, IManagerIssuanceHook preIssueHook)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndPendingMatrix(matrixToken)
    {
        _managerIssuanceHooks[matrixToken] = preIssueHook;
        matrixToken.initializeModule();
    }

    /**
     * @dev Reverts as this module should not be removable after added.
     */
    function removeModule() external pure override {
        revert("IM2"); // "The IssuanceModule module cannot be removed"
    }

    // ==================== Public functions ====================

    /**
     * @dev Retrieves the addresses and units required to issue/redeem a particular quantity of MatrixToken.
     *
     * @param matrixToken       Instance of the MatrixToken to issue
     * @param quantity          Quantity of MatrixToken to issue
     * @param isIssue           Whether the quantity is issuance or redemption
     *
     * @return components       List of component addresses
     * @return notionalUnits    List of component units required for a given MatrixToken quantity
     */
    function getRequiredComponentIssuanceUnits(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue
    ) public view returns (address[] memory components, uint256[] memory notionalUnits) {
        (components, notionalUnits) = _getTotalIssuanceUnits(matrixToken);

        for (uint256 i = 0; i < notionalUnits.length; i++) {
            // Use preciseMulCeil to round up to ensure overcollateration when small issue quantities are provided
            // and preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            notionalUnits[i] = isIssue ? notionalUnits[i].preciseMulCeil(quantity) : notionalUnits[i].preciseMul(quantity);
        }
    }

    // ==================== Internal functions ====================

    /**
     * @dev Retrieves the component addresses and list of total units for components.
     * @notice This will revert if the external unit is ever equal or less than 0 .
     */
    function _getTotalIssuanceUnits(IMatrixToken matrixToken) internal view returns (address[] memory components, uint256[] memory totalUnits) {
        components = matrixToken.getComponents();
        totalUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            int256 cumulativeUnits = matrixToken.getDefaultPositionRealUnit(component);

            address[] memory externalModules = matrixToken.getExternalPositionModules(component);
            if (externalModules.length > 0) {
                for (uint256 j = 0; j < externalModules.length; j++) {
                    int256 externalPositionUnit = matrixToken.getExternalPositionRealUnit(component, externalModules[j]);

                    require(externalPositionUnit > 0, "IM3"); // "Only positive external unit positions are supported"

                    cumulativeUnits += externalPositionUnit;
                }
            }

            totalUnits[i] = cumulativeUnits.toUint256();
        }
    }

    /**
     * @dev If a pre-issue hook has been configured, call the external-protocol contract.
     * Pre-issue hook logic can contain arbitrary logic including validations, external function calls, etc.
     * @notice All modules with external positions must implement ExternalPositionIssueHooks
     */
    function _callPreIssueHooks(
        IMatrixToken matrixToken,
        uint256 quantity,
        address caller,
        address to
    ) internal returns (address) {
        IManagerIssuanceHook preIssueHook = _managerIssuanceHooks[matrixToken];
        address result = address(preIssueHook);

        if (result != address(0)) {
            preIssueHook.invokePreIssueHook(matrixToken, quantity, caller, to);
        }

        return result;
    }

    /**
     * @dev For each component's external module positions, calculate the total notional quantity, and call the module's issue hook or redeem hook.
     * @notice It is possible that these hooks can cause the states of other modules to change.
     * It can be problematic if the a hook called an external function that called back into a module, resulting in state inconsistencies.
     */
    function _executeExternalPositionHooks(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool isIssue
    ) internal {
        address[] memory externalPositionModules = matrixToken.getExternalPositionModules(address(component));
        for (uint256 i = 0; i < externalPositionModules.length; i++) {
            isIssue
                ? IModuleIssuanceHook(externalPositionModules[i]).componentIssueHook(matrixToken, matrixTokenQuantity, component, true)
                : IModuleIssuanceHook(externalPositionModules[i]).componentRedeemHook(matrixToken, matrixTokenQuantity, component, true);
        }
    }
}
