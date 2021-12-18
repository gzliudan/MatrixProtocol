// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";
import { IManagerIssuanceHook } from "../../interfaces/IManagerIssuanceHook.sol";

/**
 * @title DebtIssuanceModule
 *
 * @dev The DebtIssuanceModule is a module that enables users to issue and redeem MatrixToken that contain default and all
 * external positions, including debt positions. Module hooks are added to allow for syncing of positions, and component
 * level hooks are added to ensure positions are replicated correctly. The manager can define arbitrary issuance logic
 * in the manager hook, as well as specify issue and redeem fees.
 */
contract DebtIssuanceModule is IDebtIssuanceModule, ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SignedMath for int256;
    using ExactSafeErc20 for IERC20;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    uint256 private constant ISSUANCE_MODULE_PROTOCOL_FEE_SPLIT_INDEX = 0;

    // ==================== Structs ====================

    // moduleIssuanceHooks uses address[] for compatibility with AddressArrayUtil library
    struct IssuanceSetting {
        uint256 maxManagerFee; // Max issue/redeem fee defined on instantiation
        uint256 managerIssueFee; // Current manager issuance fees in precise units (10^16 = 1%)
        uint256 managerRedeemFee; // Current manager redeem fees in precise units (10^16 = 1%)
        address feeRecipient; // Address that receives all manager issue and redeem fees
        IManagerIssuanceHook managerIssuanceHook; // Instance of manager defined hook, can hold arbitrary logic
        address[] moduleIssuanceHooks; // Array of modules that are registered with this module
        mapping(address => bool) isModuleHook; // Mapping of modules to if they've registered a hook
    }

    // ==================== Variables ====================

    mapping(IMatrixToken => IssuanceSetting) internal _issuanceSettings;

    // ==================== Events ====================

    event IssueMatrixToken(
        IMatrixToken indexed matrixToken,
        address indexed issuer,
        address indexed to,
        address hookContract,
        uint256 quantity,
        uint256 managerFee,
        uint256 protocolFee
    );

    event RedeemMatrixToken(
        IMatrixToken indexed matrixToken,
        address indexed redeemer,
        address indexed to,
        uint256 quantity,
        uint256 managerFee,
        uint256 protocolFee
    );

    event UpdateFeeRecipient(IMatrixToken indexed matrixToken, address newFeeRecipient);
    event UpdateIssueFee(IMatrixToken indexed matrixToken, uint256 newIssueFee);
    event UpdateRedeemFee(IMatrixToken indexed matrixToken, uint256 newRedeemFee);

    // ==================== Constructor function ====================

    constructor(IController controller) ModuleBase(controller) {}

    // ==================== External functions ====================

    function getIssuanceSetting(IMatrixToken matrixToken)
        external
        view
        returns (
            uint256 maxManagerFee,
            uint256 managerIssueFee,
            uint256 managerRedeemFee,
            address feeRecipient,
            IManagerIssuanceHook managerIssuanceHook,
            address[] memory moduleIssuanceHooks
        )
    {
        IssuanceSetting storage setting = _issuanceSettings[matrixToken];

        maxManagerFee = setting.maxManagerFee;
        managerIssueFee = setting.managerIssueFee;
        managerRedeemFee = setting.managerRedeemFee;
        feeRecipient = setting.feeRecipient;
        managerIssuanceHook = setting.managerIssuanceHook;
        moduleIssuanceHooks = setting.moduleIssuanceHooks;
    }

    /**
     * @dev Calculates the amount of each component needed to collateralize passed issue quantity plus fees of MatrixToken as well as
     * amount of debt that will be returned to caller. Values DO NOT take into account any updates from pre action manager or module hooks.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixToken to be issued
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentIssuanceUnits(IMatrixToken matrixToken, uint256 quantity)
        external
        view
        virtual
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        (uint256 totalQuantity, , ) = calculateTotalFees(matrixToken, quantity, true);
        return _calculateRequiredComponentIssuanceUnits(matrixToken, totalQuantity, true);
    }

    /**
     * @dev Calculates the amount of each component will be returned on redemption net of fees as well as how much debt
     * needs to be paid down to redeem. Values DO NOT take into account any updates from pre action manager or module hooks.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixToken to be redeemed
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentRedemptionUnits(IMatrixToken matrixToken, uint256 quantity)
        external
        view
        virtual
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        (uint256 totalQuantity, , ) = calculateTotalFees(matrixToken, quantity, false);
        return _calculateRequiredComponentIssuanceUnits(matrixToken, totalQuantity, false);
    }

    function getModuleIssuanceHooks(IMatrixToken matrixToken) external view returns (address[] memory) {
        return _issuanceSettings[matrixToken].moduleIssuanceHooks;
    }

    function isModuleIssuanceHook(IMatrixToken matrixToken, address _hook) external view returns (bool) {
        return _issuanceSettings[matrixToken].isModuleHook[_hook];
    }

    /**
     * @dev MANAGER ONLY: Initializes this module to the MatrixToken with issuance-related hooks and fee information. Only callable
     * by the MatrixToken's manager. Hook addresses are optional. Address(0) means that no hook will be called
     *
     * @param matrixToken            Instance of the MatrixToken to issue
     * @param maxManagerFee          Maximum fee that can be charged on issue and redeem
     * @param managerIssueFee        Fee to charge on issuance
     * @param managerRedeemFee       Fee to charge on redemption
     * @param feeRecipient           Address to send fees to
     * @param managerIssuanceHook    Instance of the Manager Contract with the Pre-Issuance Hook function
     */
    function initialize(
        IMatrixToken matrixToken,
        uint256 maxManagerFee,
        uint256 managerIssueFee,
        uint256 managerRedeemFee,
        address feeRecipient,
        IManagerIssuanceHook managerIssuanceHook
    ) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        require(managerIssueFee <= maxManagerFee, "D0a"); // "Issue fee can't exceed maximum fee"
        require(managerRedeemFee <= maxManagerFee, "D0b"); // "Redeem fee can't exceed maximum fee"

        IssuanceSetting storage issuanceSetting = _issuanceSettings[matrixToken];
        issuanceSetting.maxManagerFee = maxManagerFee;
        issuanceSetting.managerIssueFee = managerIssueFee;
        issuanceSetting.managerRedeemFee = managerRedeemFee;
        issuanceSetting.feeRecipient = feeRecipient;
        issuanceSetting.managerIssuanceHook = managerIssuanceHook;

        matrixToken.initializeModule();
    }

    /**
     * @dev MatrixToken ONLY: Allows removal of module (and deletion of state) if no other modules are registered.
     * @notice control permission by msg.sender
     */
    function removeModule() external override {
        require(_issuanceSettings[IMatrixToken(msg.sender)].moduleIssuanceHooks.length == 0, "D1"); // "Registered modules must be removed"

        delete _issuanceSettings[IMatrixToken(msg.sender)];
    }

    /**
     * @dev Deposits components to the MatrixToken, replicates any external module component positions and mints
     * the MatrixToken. If the token has a debt position all collateral will be transferred in first then debt
     * will be returned to the minting address. If specified, a fee will be charged on issuance.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     * @param quantity       Quantity of MatrixToken to issue
     * @param to             Address to mint MatrixToken to
     */
    function issue(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external virtual nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "D2"); // "Issue quantity must be > 0"

        address hookContract = _callManagerPreIssueHooks(matrixToken, quantity, msg.sender, to);

        _callModulePreIssueHooks(matrixToken, quantity);

        (uint256 quantityWithFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, quantity, true);

        (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
            matrixToken,
            quantityWithFees,
            true
        );

        _resolveEquityPositions(matrixToken, quantityWithFees, to, true, components, equityUnits);
        _resolveDebtPositions(matrixToken, quantityWithFees, true, components, debtUnits);
        _resolveFees(matrixToken, managerFee, protocolFee);
        matrixToken.mint(to, quantity);

        emit IssueMatrixToken(matrixToken, msg.sender, to, hookContract, quantity, managerFee, protocolFee);
    }

    /**
     * @dev Returns components from the MatrixToken, unwinds any external module component positions and burns the MatrixToken.
     * If the token has debt positions, the module transfers in the required debt amounts from the caller and uses
     * those funds to repay the debts on behalf of the MatrixToken. All debt will be paid down first then equity positions
     * will be returned to the minting address. If specified, a fee will be charged on redeem.
     *
     * @param matrixToken    Instance of the MatrixToken to redeem
     * @param quantity       Quantity of MatrixToken to redeem
     * @param to             Address to send collateral to
     */
    function redeem(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to
    ) external virtual nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        require(quantity > 0, "D3"); // "Redeem quantity must be > 0"

        _callModulePreRedeemHooks(matrixToken, quantity);

        // Place burn after pre-redeem hooks because burning tokens may lead to false accounting of synced positions
        matrixToken.burn(msg.sender, quantity);

        (uint256 quantityNetFees, uint256 managerFee, uint256 protocolFee) = calculateTotalFees(matrixToken, quantity, false);

        (address[] memory components, uint256[] memory equityUnits, uint256[] memory debtUnits) = _calculateRequiredComponentIssuanceUnits(
            matrixToken,
            quantityNetFees,
            false
        );

        _resolveDebtPositions(matrixToken, quantityNetFees, false, components, debtUnits);
        _resolveEquityPositions(matrixToken, quantityNetFees, to, false, components, equityUnits);
        _resolveFees(matrixToken, managerFee, protocolFee);

        emit RedeemMatrixToken(matrixToken, msg.sender, to, quantity, managerFee, protocolFee);
    }

    /**
     * @dev MANAGER ONLY: Updates address receiving issue/redeem fees for a given MatrixToken.
     *
     * @param matrixToken        Instance of the MatrixToken to update fee recipient
     * @param newFeeRecipient    New fee recipient address
     */
    function updateFeeRecipient(IMatrixToken matrixToken, address newFeeRecipient) external onlyManagerAndValidMatrix(matrixToken) {
        require(newFeeRecipient != address(0), "D4a"); // "Fee Recipient must be non-zero address"
        require(newFeeRecipient != _issuanceSettings[matrixToken].feeRecipient, "D4b"); // "Same fee recipient passed"

        _issuanceSettings[matrixToken].feeRecipient = newFeeRecipient;

        emit UpdateFeeRecipient(matrixToken, newFeeRecipient);
    }

    /**
     * @dev MANAGER ONLY: Updates issue fee for passed MatrixToken
     *
     * @param matrixToken    Instance of the MatrixToken to update issue fee
     * @param newIssueFee    New fee amount in preciseUnits (1% = 10^16)
     */
    function updateIssueFee(IMatrixToken matrixToken, uint256 newIssueFee) external onlyManagerAndValidMatrix(matrixToken) {
        require(newIssueFee <= _issuanceSettings[matrixToken].maxManagerFee, "D5a"); // "Issue fee can't exceed maximum"
        require(newIssueFee != _issuanceSettings[matrixToken].managerIssueFee, "D5b"); // "Same issue fee passed"

        _issuanceSettings[matrixToken].managerIssueFee = newIssueFee;

        emit UpdateIssueFee(matrixToken, newIssueFee);
    }

    /**
     * @dev MANAGER ONLY: Updates redeem fee for passed MatrixToken
     *
     * @param matrixToken     Instance of the MatrixToken to update redeem fee
     * @param newRedeemFee    New fee amount in preciseUnits (1% = 10^16)
     */
    function updateRedeemFee(IMatrixToken matrixToken, uint256 newRedeemFee) external onlyManagerAndValidMatrix(matrixToken) {
        require(newRedeemFee <= _issuanceSettings[matrixToken].maxManagerFee, "D6a"); // "Redeem fee can't exceed maximum"
        require(newRedeemFee != _issuanceSettings[matrixToken].managerRedeemFee, "D6b"); // "Same redeem fee passed"

        _issuanceSettings[matrixToken].managerRedeemFee = newRedeemFee;

        emit UpdateRedeemFee(matrixToken, newRedeemFee);
    }

    /**
     * @dev MODULE ONLY: Adds calling module to array of modules that require they be called before component hooks are
     * called. Can be used to sync debt positions before issuance.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     */
    function registerToIssuanceModule(IMatrixToken matrixToken) external onlyModule(matrixToken) onlyValidAndInitializedMatrix(matrixToken) {
        require(!_issuanceSettings[matrixToken].isModuleHook[msg.sender], "D7"); // "Module already registered"

        _issuanceSettings[matrixToken].moduleIssuanceHooks.push(msg.sender);
        _issuanceSettings[matrixToken].isModuleHook[msg.sender] = true;
    }

    /**
     * @dev MODULE ONLY: Removes calling module from array of modules that require they be called before component hooks are
     * called.
     *
     * @param matrixToken             Instance of the MatrixToken to issue
     */
    function unregisterFromIssuanceModule(IMatrixToken matrixToken) external onlyModule(matrixToken) onlyValidAndInitializedMatrix(matrixToken) {
        require(_issuanceSettings[matrixToken].isModuleHook[msg.sender], "D8"); // "Module not registered"

        _issuanceSettings[matrixToken].moduleIssuanceHooks.quickRemoveItem(msg.sender);
        _issuanceSettings[matrixToken].isModuleHook[msg.sender] = false;
    }

    // ==================== Public functions ====================

    /**
     * @dev Calculates the manager fee, protocol fee and resulting totalQuantity to use when calculating unit amounts.
     * If fees are charged they are added to the total issue quantity, for example 1% fee on 100 MatrixToken means
     * 101 MatrixToken are minted by caller, the to address receives 100 and the feeRecipient receives 1.
     * Conversely, on redemption the redeemer will only receive the collateral that collateralizes 99 MatrixToken,
     * while the additional MatrixToken is given to the feeRecipient.
     *
     * @param matrixToken       Instance of the MatrixToken to issue
     * @param quantity          Amount of MatrixToken issuer wants to receive/redeem
     * @param isIssue           If issuing or redeeming
     *
     * @return totalQuantity    Total amount of MatrixToken to be issued/redeemed with fee adjustment
     * @return managerFee       MatrixToken minted to the manager
     * @return protocolFee      MatrixToken minted to the protocol
     */
    function calculateTotalFees(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue
    )
        public
        view
        returns (
            uint256 totalQuantity,
            uint256 managerFee,
            uint256 protocolFee
        )
    {
        IssuanceSetting storage settings = _issuanceSettings[matrixToken];
        uint256 protocolFeeSplit = _controller.getModuleFee(address(this), ISSUANCE_MODULE_PROTOCOL_FEE_SPLIT_INDEX);
        uint256 totalFee = quantity.preciseMul(isIssue ? settings.managerIssueFee : settings.managerRedeemFee);

        protocolFee = totalFee.preciseMul(protocolFeeSplit);
        managerFee = totalFee - protocolFee;
        totalQuantity = isIssue ? (quantity + totalFee) : (quantity - totalFee);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Calculates the amount of each component needed to collateralize passed issue quantity of MatrixToken
     * as well as amount of debt that will be returned to caller. Can also be used to determine how much collateral
     * will be returned on redemption as well as how much debt needs to be paid down to redeem.
     *
     * @param matrixToken          Instance of the MatrixToken to issue
     * @param quantity             Amount of MatrixToken to be issued/redeemed
     * @param isIssue              Whether MatrixToken are being issued or redeemed
     *
     * @return components          Array of component addresses making up the MatrixToken
     * @return totalEquityUnits    Array of equity notional amounts of each component, respectively, represented as uint256
     * @return totalDebtUnits      Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function _calculateRequiredComponentIssuanceUnits(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue
    )
        internal
        view
        returns (
            address[] memory components,
            uint256[] memory totalEquityUnits,
            uint256[] memory totalDebtUnits
        )
    {
        (components, totalEquityUnits, totalDebtUnits) = _getTotalIssuanceUnits(matrixToken);

        for (uint256 i = 0; i < components.length; i++) {
            // Use preciseMulCeil to round up to ensure overcollateration when small issue quantities are provided
            // and preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            (totalEquityUnits[i], totalDebtUnits[i]) = isIssue
                ? (totalEquityUnits[i].preciseMulCeil(quantity), totalDebtUnits[i].preciseMul(quantity))
                : (totalEquityUnits[i].preciseMul(quantity), totalDebtUnits[i].preciseMulCeil(quantity));
        }
    }

    /**
     * @dev Sums total debt and equity units for each component, taking into account default and external positions.
     *
     * @param matrixToken     Instance of the MatrixToken to issue
     *
     * @return components     Array of component addresses making up the MatrixToken
     * @return equityUnits    Array of equity unit amounts of each component, respectively, represented as uint256
     * @return debtUnits      Array of debt unit amounts of each component, respectively, represented as uint256
     */
    function _getTotalIssuanceUnits(IMatrixToken matrixToken)
        internal
        view
        returns (
            address[] memory components,
            uint256[] memory equityUnits,
            uint256[] memory debtUnits
        )
    {
        components = matrixToken.getComponents();
        equityUnits = new uint256[](components.length);
        debtUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            int256 cumulativeEquity = matrixToken.getDefaultPositionRealUnit(components[i]);

            address[] memory externalPositions = matrixToken.getExternalPositionModules(components[i]);
            if (externalPositions.length > 0) {
                int256 cumulativeDebt = 0;

                for (uint256 j = 0; j < externalPositions.length; j++) {
                    int256 externalPositionUnit = matrixToken.getExternalPositionRealUnit(components[i], externalPositions[j]);

                    // If positionUnit < 0 it will be "added" to debt position
                    if (externalPositionUnit >= 0) {
                        cumulativeEquity += externalPositionUnit;
                    } else {
                        cumulativeDebt += externalPositionUnit;
                    }
                }

                debtUnits[i] = cumulativeDebt.abs(); // cumulativeDebt.mul(-1).toUint256();
            }

            equityUnits[i] = cumulativeEquity.toUint256();
        }
    }

    /**
     * @dev Resolve equity positions associated with MatrixToken. On issuance, the total equity position for an asset
     * (including default and external positions) is transferred in. Then any external position hooks are called to
     * transfer the external positions to their necessary place. On redemption all external positions are recalled
     * by the external position hook, then those position plus any default position are transferred back to the to address.
     */
    function _resolveEquityPositions(
        IMatrixToken matrixToken,
        uint256 quantity,
        address to,
        bool isIssue,
        address[] memory components,
        uint256[] memory componentEquityQuantities
    ) internal {
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            uint256 componentQuantity = componentEquityQuantities[i];

            if (componentQuantity > 0) {
                if (isIssue) {
                    IERC20(component).exactSafeTransferFrom(msg.sender, address(matrixToken), componentQuantity);
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), true, true);
                } else {
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), false, true);
                    matrixToken.invokeExactSafeTransfer(component, to, componentQuantity);
                }
            }
        }
    }

    /**
     * @dev Resolve debt positions associated with MatrixToken. On issuance, debt positions are entered into by calling
     * the external position hook. The resulting debt is then returned to the calling address. On redemption, the module
     * transfers in the required debt amount from the caller and uses those funds to repay the debt on behalf of the MatrixToken.
     */
    function _resolveDebtPositions(
        IMatrixToken matrixToken,
        uint256 quantity,
        bool isIssue,
        address[] memory components,
        uint256[] memory componentDebtQuantities
    ) internal {
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            uint256 componentQuantity = componentDebtQuantities[i];

            if (componentQuantity > 0) {
                if (isIssue) {
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), true, false);
                    matrixToken.invokeExactSafeTransfer(component, msg.sender, componentQuantity);
                } else {
                    IERC20(component).exactSafeTransferFrom(msg.sender, address(matrixToken), componentQuantity);
                    _executeExternalPositionHooks(matrixToken, quantity, IERC20(component), false, false);
                }
            }
        }
    }

    /**
     * @dev If any manager fees mints MatrixToken to the defined feeRecipient.
     * If protocol fee is enabled mints MatrixToken to protocol feeRecipient.
     */
    function _resolveFees(
        IMatrixToken matrixToken,
        uint256 managerFee,
        uint256 protocolFee
    ) internal {
        if (managerFee > 0) {
            matrixToken.mint(_issuanceSettings[matrixToken].feeRecipient, managerFee);

            // Protocol fee check is inside manager fee check because protocol fees are only collected on manager fees
            if (protocolFee > 0) {
                matrixToken.mint(_controller.getFeeRecipient(), protocolFee);
            }
        }
    }

    /**
     * @dev If a pre-issue hook has been configured, call the external-protocol contract.
     * Pre-issue hook logic can contain arbitrary logic including validations, external function calls, etc.
     */
    function _callManagerPreIssueHooks(
        IMatrixToken matrixToken,
        uint256 quantity,
        address caller,
        address to
    ) internal returns (address) {
        IManagerIssuanceHook preIssueHook = _issuanceSettings[matrixToken].managerIssuanceHook;

        address result = address(preIssueHook);
        if (result != address(0)) {
            preIssueHook.invokePreIssueHook(matrixToken, quantity, caller, to);
        }

        return result;
    }

    /**
     * @dev Calls all modules that have registered with the DebtIssuanceModule that have a moduleIssueHook.
     */
    function _callModulePreIssueHooks(IMatrixToken matrixToken, uint256 quantity) internal {
        address[] memory issuanceHooks = _issuanceSettings[matrixToken].moduleIssuanceHooks;

        for (uint256 i = 0; i < issuanceHooks.length; i++) {
            IModuleIssuanceHook(issuanceHooks[i]).moduleIssueHook(matrixToken, quantity);
        }
    }

    /**
     * @dev Calls all modules that have registered with the DebtIssuanceModule that have a moduleRedeemHook.
     */
    function _callModulePreRedeemHooks(IMatrixToken matrixToken, uint256 quantity) internal {
        address[] memory issuanceHooks = _issuanceSettings[matrixToken].moduleIssuanceHooks;
        for (uint256 i = 0; i < issuanceHooks.length; i++) {
            IModuleIssuanceHook(issuanceHooks[i]).moduleRedeemHook(matrixToken, quantity);
        }
    }

    /**
     * @dev For each component's external module positions, calculate the total notional quantity, and call the module's issue hook or redeem hook.
     *
     * @notice It is possible that these hooks can cause the states of other modules to change. It can be problematic
     * if the hook called an external function that called back into a module, resulting in state inconsistencies.
     */
    function _executeExternalPositionHooks(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool isIssue,
        bool isEquity
    ) internal {
        address[] memory externalPositionModules = matrixToken.getExternalPositionModules(address(component));

        for (uint256 i = 0; i < externalPositionModules.length; i++) {
            isIssue
                ? IModuleIssuanceHook(externalPositionModules[i]).componentIssueHook(matrixToken, matrixTokenQuantity, component, isEquity)
                : IModuleIssuanceHook(externalPositionModules[i]).componentRedeemHook(matrixToken, matrixTokenQuantity, component, isEquity);
        }
    }
}
