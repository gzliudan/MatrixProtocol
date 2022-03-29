// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IManagerIssuanceHook } from "../../interfaces/IManagerIssuanceHook.sol";

/**
 * @title BasicIssuanceModule
 *
 * @dev Module that enables issuance and redemption functionality on a MatrixToken.
 * This is a module that is required to bring the totalSupply of a Set above 0.
 */
contract BasicIssuanceModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using ExactSafeErc20 for IERC20;
    using PreciseUnitMath for uint256;
    using PositionUtil for IMatrixToken;

    // ==================== Variables ====================

    // MatrixToken => Issuance hook configurations
    mapping(IMatrixToken => IManagerIssuanceHook) internal _managerIssuanceHooks;

    // ==================== Events ====================

    event IssueMatrixToken(
        address indexed matrixToken,
        address indexed issuer,
        address indexed to,
        address hookContract,
        uint256 quantity,
        address[] components,
        uint256[] componentQuantities
    );

    event RedeemMatrixToken(
        address indexed matrixToken,
        address indexed redeemer,
        address indexed to,
        uint256 quantity,
        address[] components,
        uint256[] componentQuantities
    );

    // ==================== Constructor function ====================

    /**
     * @param controller    Address of controller contract
     */
    constructor(IController controller) ModuleBase(controller) {}

    // ==================== External functions ====================

    function getManagerIssuanceHook(IMatrixToken matrixToken) external view returns (IManagerIssuanceHook) {
        return _managerIssuanceHooks[matrixToken];
    }

    /**
     * @dev Initializes this module to the MatrixToken with issuance-related hooks. Only callable by the MatrixToken's manager.
     * @notice Hook addresses are optional. Address(0) means that no hook will be called
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
     * @dev Reverts as this module should not be removable after added. Users should always have a way to redeem their matrix.
     */
    function removeModule() external pure override {
        revert("BI0"); // "The BasicIssuanceModule module cannot be removed"
    }

    /**
     * @dev Deposits the MatrixToken's position components into the MatrixToken
     * and mints the MatrixToken of the given quantity to the specified to address.
     * @notice This function only handles Default Positions (positionState = 0).
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
        require(quantity > 0, "BI1"); // "Issue quantity must be > 0"

        address hookContract = _callPreIssueHooks(matrixToken, quantity, msg.sender, to);
        (address[] memory components, uint256[] memory componentQuantities) = getRequiredComponentUnitsForIssue(matrixToken, quantity);

        // For each position, transfer the required underlying to the MatrixToken
        for (uint256 i = 0; i < components.length; i++) {
            // Transfer the component to the MatrixToken
            IERC20(components[i]).exactSafeTransferFrom(msg.sender, address(matrixToken), componentQuantities[i]);
        }

        // Mint the MatrixToken
        matrixToken.mint(to, quantity);

        emit IssueMatrixToken(address(matrixToken), msg.sender, to, hookContract, quantity, components, componentQuantities);
    }

    /**
     * @dev Redeems the MatrixToken's positions and sends the components of the given
     * quantity to the caller. This function only handles Default Positions (positionState = 0).
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
        require(quantity > 0, "BI2a"); // "Redeem quantity must be > 0"

        // Burn the MatrixToken - ERC20's internal burn already checks that the user has enough balance
        matrixToken.burn(msg.sender, quantity);

        address[] memory components = matrixToken.getComponents();
        uint256[] memory componentQuantities = new uint256[](components.length);

        // For each position, invoke the MatrixToken to transfer the tokens to the user
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            require(!matrixToken.hasExternalPosition(component), "BI2b"); // "Only default positions are supported"

            uint256 unit = matrixToken.getDefaultPositionRealUnit(component).toUint256();

            // Use preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            componentQuantities[i] = quantity.preciseMul(unit);

            // Instruct the MatrixToken to transfer the component to the user
            matrixToken.invokeExactSafeTransfer(component, to, componentQuantities[i]);
        }

        emit RedeemMatrixToken(address(matrixToken), msg.sender, to, quantity, components, componentQuantities);
    }

    // ==================== Public functions ====================

    /**
     * @dev Retrieves the addresses and units required to mint a particular quantity of MatrixToken.
     *
     * @param matrixToken       Instance of the MatrixToken to issue
     * @param quantity          Quantity of MatrixToken to issue
     *
     * @return components       List of component addresses
     * @return notionalUnits    List of component units required to issue the quantity of MatrixToken
     */
    function getRequiredComponentUnitsForIssue(IMatrixToken matrixToken, uint256 quantity)
        public
        view
        onlyValidAndInitializedMatrix(matrixToken)
        returns (address[] memory components, uint256[] memory notionalUnits)
    {
        components = matrixToken.getComponents();
        notionalUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            require(!matrixToken.hasExternalPosition(components[i]), "BI3"); // "Only default positions are supported"
            notionalUnits[i] = matrixToken.getDefaultPositionRealUnit(components[i]).toUint256().preciseMulCeil(quantity);
        }
    }

    // ==================== Internal functions ====================

    /**
     * @dev If a pre-issue hook has been configured, call the external-protocol contract.
     * Pre-issue hook logic can contain arbitrary logic including validations, external function calls, etc.
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
}
