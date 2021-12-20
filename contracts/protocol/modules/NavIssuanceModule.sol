// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ExactSafeErc20 } from "../../lib/ExactSafeErc20.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { INavIssuanceHook } from "../../interfaces/INavIssuanceHook.sol";

/**
 * @title NavIssuanceModule
 *
 * @dev Module that enables issuance and redemption with any valid ERC20 token or ETH if allowed by the manager. Sender receives
 * a proportional amount of MatrixToken on issuance or ERC20 token on redemption based on the calculated net asset value using
 * oracle prices. Manager is able to enforce a premium / discount on issuance / redemption to avoid arbitrage and front
 * running when relying on oracle prices. Managers can charge a fee (denominated in reserve asset).
 */
contract NavIssuanceModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using ExactSafeErc20 for IERC20;
    using PositionUtil for IMatrixToken;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    // 0 index stores the manager fee percentage in managerFees array, charged on issue (denominated in reserve asset)
    uint256 internal constant MANAGER_ISSUE_FEE_INDEX = 0;

    // 1 index stores the manager fee percentage in managerFees array, charged on redeem
    uint256 internal constant MANAGER_REDEEM_FEE_INDEX = 1;

    // 0 index stores the manager revenue share protocol fee % on the controller, charged in the issuance function
    uint256 internal constant PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX = 0;

    // 1 index stores the manager revenue share protocol fee % on the controller, charged in the redeem function
    uint256 internal constant PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX = 1;

    // 2 index stores the direct protocol fee % on the controller, charged in the issuance function
    uint256 internal constant PROTOCOL_ISSUE_DIRECT_FEE_INDEX = 2;

    // 3 index stores the direct protocol fee % on the controller, charged in the redeem function
    uint256 internal constant PROTOCOL_REDEEM_DIRECT_FEE_INDEX = 3;

    // ==================== Structs ====================

    /**
     * @dev Premium is a buffer around oracle prices paid by user to the MatrixToken, which prevents arbitrage and oracle front running
     */
    struct IssuanceSetting {
        uint256 maxManagerFee; // Maximum fee manager is allowed to set for issue and redeem
        uint256 premiumPercentage; // Premium percentage (0.01% = 1e14, 1% = 1e16).
        uint256 maxPremiumPercentage; // Maximum premium percentage manager is allowed to set (configured by manager)
        uint256 minMatrixTokenSupply; // Minimum supply required for issuance and redemption, prevent dramatic inflationary changes to the MatrixToken's position multiplier
        address feeRecipient; // Manager fee recipient
        INavIssuanceHook managerIssuanceHook; // Issuance hook configurations
        INavIssuanceHook managerRedemptionHook; // Redemption hook configurations
        uint256[2] managerFees; // Manager fees. 0 index is issue and 1 index is redeem fee (0.01% = 1e14, 1% = 1e16)
        address[] reserveAssets; // Allowed reserve assets - Must have a price enabled with the price oracle
    }

    struct ActionInfo {
        uint256 preFeeReserveQuantity; // Reserve value before fees; During issuance, represents raw quantity during redeem, represents post-premium value
        uint256 protocolFees; // Total protocol fees (direct + manager revenue share)
        uint256 managerFee; // Total manager fee paid in reserve asset
        uint256 netFlowQuantity; // When issuing, quantity of reserve asset sent to MatrixToken when redeeming, quantity of reserve asset sent to redeemer
        uint256 matrixTokenQuantity; // When issuing, quantity of minted to mintee; When redeeming, quantity of redeemed
        uint256 previousMatrixTokenSupply; // supply prior to issue/redeem action
        uint256 newMatrixTokenSupply; // supply after issue/redeem action
        uint256 newReservePositionUnit; // MatrixToken reserve asset position unit after issue/redeem
        int256 newPositionMultiplier; // MatrixToken position multiplier after issue/redeem
    }

    // ==================== Variables ====================

    IWETH internal immutable _weth;

    mapping(IMatrixToken => IssuanceSetting) internal _issuanceSettings;

    // MatrixToken => reserveAsset => isReserved
    mapping(IMatrixToken => mapping(address => bool)) internal _isReserveAssets;

    // ==================== Events ====================

    event IssueMatrixTokenNav(
        IMatrixToken indexed matrixToken,
        address issuer,
        address to,
        address reserveAsset,
        address hookContract,
        uint256 matrixTokenQuantity,
        uint256 managerFee,
        uint256 premium
    );

    event RedeemMatrixTokenNav(
        IMatrixToken indexed matrixToken,
        address redeemer,
        address to,
        address reserveAsset,
        address hookContract,
        uint256 matrixTokenQuantity,
        uint256 managerFee,
        uint256 premium
    );

    event AddReserveAsset(IMatrixToken indexed matrixToken, address newReserveAsset);
    event RemoveReserveAsset(IMatrixToken indexed matrixToken, address removedReserveAsset);
    event EditPremium(IMatrixToken indexed matrixToken, uint256 newPremium);
    event EditManagerFee(IMatrixToken indexed matrixToken, uint256 newManagerFee, uint256 index);
    event EditFeeRecipient(IMatrixToken indexed matrixToken, address feeRecipient);

    // ==================== Constructor function ====================

    constructor(IController controller, IWETH weth) ModuleBase(controller) {
        _weth = weth;
    }

    // ==================== Receive function ====================

    receive() external payable {}

    // ==================== External functions ====================

    function getWeth() external view returns (address) {
        return address(_weth);
    }

    function getIssuanceSetting(IMatrixToken matrixToken) external view returns (IssuanceSetting memory) {
        return _issuanceSettings[matrixToken];
    }

    function getReserveAssets(IMatrixToken matrixToken) external view returns (address[] memory) {
        return _issuanceSettings[matrixToken].reserveAssets;
    }

    function isReserveAsset(IMatrixToken matrixToken, address asset) external view returns (bool) {
        return _isReserveAssets[matrixToken][asset];
    }

    function getIssuePremium(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity
    ) external view returns (uint256) {
        return _getIssuePremium(matrixToken, reserveAsset, reserveAssetQuantity);
    }

    function getRedeemPremium(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) external view returns (uint256) {
        return _getRedeemPremium(matrixToken, reserveAsset, matrixTokenQuantity);
    }

    function getManagerFee(IMatrixToken matrixToken, uint256 managerFeeIndex) external view returns (uint256) {
        return _issuanceSettings[matrixToken].managerFees[managerFeeIndex];
    }

    /**
     * @dev Get the expected MatrixToken minted to recipient on issuance
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param reserveAsset           Address of the reserve asset
     * @param reserveAssetQuantity   Quantity of the reserve asset to issue with
     *
     * @return uint256               Expected MatrixToken to be minted to recipient
     */
    function getExpectedMatrixTokenIssueQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity
    ) external view returns (uint256) {
        uint256 totalSupply = matrixToken.totalSupply();

        (, , uint256 netReserveFlow) = _getFees(
            matrixToken,
            reserveAssetQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        return _getMatrixTokenMintQuantity(matrixToken, reserveAsset, netReserveFlow, totalSupply);
    }

    /**
     * @dev Get the expected reserve asset to be redeemed
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param reserveAsset           Address of the reserve asset
     * @param matrixTokenQuantity    Quantity of MatrixToken to redeem
     *
     * @return uint256               Expected reserve asset quantity redeemed
     */
    function getExpectedReserveRedeemQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) external view returns (uint256) {
        uint256 preFeeReserveQuantity = _getRedeemReserveQuantity(matrixToken, reserveAsset, matrixTokenQuantity);

        (, , uint256 netReserveFlows) = _getFees(
            matrixToken,
            preFeeReserveQuantity,
            PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
            MANAGER_REDEEM_FEE_INDEX
        );

        return netReserveFlows;
    }

    /**
     * @dev Checks if issue is valid
     *
     * @param matrixToken             Instance of the MatrixToken
     * @param reserveAsset            Address of the reserve asset
     * @param reserveAssetQuantity    Quantity of the reserve asset to issue with
     *
     * @return bool                   Returns true if issue is valid
     */
    function isValidIssue(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity
    ) external view returns (bool) {
        return
            reserveAssetQuantity != 0 &&
            _isReserveAssets[matrixToken][reserveAsset] &&
            matrixToken.totalSupply() >= _issuanceSettings[matrixToken].minMatrixTokenSupply;
    }

    /**
     * @dev Checks if redeem is valid
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param reserveAsset           Address of the reserve asset
     * @param matrixTokenQuantity    Quantity of MatrixToken to redeem
     *
     * @return bool                  Returns true if redeem is valid
     */
    function isValidRedeem(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) external view returns (bool) {
        uint256 totalSupply = matrixToken.totalSupply();

        if (
            (matrixTokenQuantity == 0) ||
            !_isReserveAssets[matrixToken][reserveAsset] ||
            (totalSupply < _issuanceSettings[matrixToken].minMatrixTokenSupply + matrixTokenQuantity)
        ) {
            return false;
        } else {
            uint256 existingUnit = matrixToken.getDefaultPositionRealUnit(reserveAsset).toUint256();
            uint256 totalRedeemValue = _getRedeemReserveQuantity(matrixToken, reserveAsset, matrixTokenQuantity);

            (, , uint256 expectedRedeemQuantity) = _getFees(
                matrixToken,
                totalRedeemValue,
                PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
                PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
                MANAGER_REDEEM_FEE_INDEX
            );

            return existingUnit.preciseMul(totalSupply) >= expectedRedeemQuantity;
        }
    }

    /**
     * @dev Initializes this module to the MatrixToken with hooks, allowed reserve assets,
     * fees and issuance premium. Only callable by the MatrixToken's manager. Hook addresses are optional.
     * Address(0) means that no hook will be called.
     *
     * @param matrixToken        Instance of the MatrixToken to issue
     * @param issuanceSetting    IssuanceSetting struct defining parameters
     */
    function initialize(IMatrixToken matrixToken, IssuanceSetting memory issuanceSetting)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndPendingMatrix(matrixToken)
    {
        require(issuanceSetting.reserveAssets.length > 0, "N0a"); // "Reserve assets must be greater than 0"
        require(issuanceSetting.maxManagerFee < PreciseUnitMath.preciseUnit(), "N0b"); // "Max manager fee must be less than 100%"
        require(issuanceSetting.maxPremiumPercentage < PreciseUnitMath.preciseUnit(), "N0c"); // "Max premium percentage must be less than 100%"
        require(issuanceSetting.managerFees[0] <= issuanceSetting.maxManagerFee, "N0d"); // "Manager issue fee must be less than max"
        require(issuanceSetting.managerFees[1] <= issuanceSetting.maxManagerFee, "N0e"); // "Manager redeem fee must be less than max"
        require(issuanceSetting.premiumPercentage <= issuanceSetting.maxPremiumPercentage, "N0f"); // "Premium must be less than max"
        require(issuanceSetting.feeRecipient != address(0), "N0g"); // "Fee Recipient must be non-zero address"

        // Initial mint cannot use NAVIssuance since minMatrixTokenSupply must be > 0
        require(issuanceSetting.minMatrixTokenSupply > 0, "N0h"); // "Min MatrixToken supply must be greater than 0"

        for (uint256 i = 0; i < issuanceSetting.reserveAssets.length; i++) {
            require(!_isReserveAssets[matrixToken][issuanceSetting.reserveAssets[i]], "N0i"); // "Reserve assets must be unique"

            _isReserveAssets[matrixToken][issuanceSetting.reserveAssets[i]] = true;
        }

        _issuanceSettings[matrixToken] = issuanceSetting;
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken when called by the MatrixToken, delete issuance setting and reserve asset states.
     */
    function removeModule() external override {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);

        for (uint256 i = 0; i < _issuanceSettings[matrixToken].reserveAssets.length; i++) {
            delete _isReserveAssets[matrixToken][_issuanceSettings[matrixToken].reserveAssets[i]];
        }

        delete _issuanceSettings[matrixToken];
    }

    /**
     * @dev Deposits the allowed reserve asset into the MatrixToken and
     * mints the appropriate % of Net Asset Value of the MatrixToken to the specified to address.
     *
     * @param matrixToken                      Instance of the MatrixToken contract
     * @param reserveAsset                     Address of the reserve asset to issue with
     * @param reserveAssetQuantity             Quantity of the reserve asset to issue with
     * @param minMatrixTokenReceiveQuantity    Min quantity of MatrixToken to receive after issuance
     * @param to                               Address to mint MatrixToken to
     */
    function issue(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity,
        uint256 minMatrixTokenReceiveQuantity,
        address to
    ) external nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _validateCommon(matrixToken, reserveAsset, reserveAssetQuantity);
        _callPreIssueHooks(matrixToken, reserveAsset, reserveAssetQuantity, msg.sender, to);
        ActionInfo memory issueInfo = _createIssuanceInfo(matrixToken, reserveAsset, reserveAssetQuantity);
        _validateIssuanceInfo(matrixToken, minMatrixTokenReceiveQuantity, issueInfo);
        _transferCollateralAndHandleFees(matrixToken, IERC20(reserveAsset), issueInfo);
        _handleIssueStateUpdates(matrixToken, reserveAsset, to, issueInfo);
    }

    /**
     * @dev Wraps ETH and deposits WETH if allowed into the MatrixToken and
     * mints the appropriate % of Net Asset Value of the MatrixToken to the specified _to address.
     *
     * @param matrixToken                      Instance of the MatrixToken contract
     * @param minMatrixTokenReceiveQuantity    Min quantity of MatrixToken to receive after issuance
     * @param to                               Address to mint MatrixToken to
     */
    function issueWithEther(
        IMatrixToken matrixToken,
        uint256 minMatrixTokenReceiveQuantity,
        address to
    ) external payable nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _weth.deposit{ value: msg.value }();
        _validateCommon(matrixToken, address(_weth), msg.value);
        _callPreIssueHooks(matrixToken, address(_weth), msg.value, msg.sender, to);
        ActionInfo memory issueInfo = _createIssuanceInfo(matrixToken, address(_weth), msg.value);
        _validateIssuanceInfo(matrixToken, minMatrixTokenReceiveQuantity, issueInfo);
        _transferWethAndHandleFees(matrixToken, issueInfo);
        _handleIssueStateUpdates(matrixToken, address(_weth), to, issueInfo);
    }

    /**
     * @dev Redeems a MatrixToken into a valid reserve asset representing the appropriate % of Net Asset Value of
     * the MatrixToken to the specified _to address. Only valid if there are available reserve units on the MatrixToken.
     *
     * @param matrixToken                  Instance of the MatrixToken contract
     * @param reserveAsset                 Address of the reserve asset to redeem with
     * @param matrixTokenQuantity          Quantity of MatrixToken to redeem
     * @param minReserveReceiveQuantity    Min quantity of reserve asset to receive
     * @param to                           Address to redeem reserve asset to
     */
    function redeem(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity,
        uint256 minReserveReceiveQuantity,
        address to
    ) external nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _validateCommon(matrixToken, reserveAsset, matrixTokenQuantity);
        _callPreRedeemHooks(matrixToken, matrixTokenQuantity, msg.sender, to);
        ActionInfo memory redeemInfo = _createRedemptionInfo(matrixToken, reserveAsset, matrixTokenQuantity);
        _validateRedemptionInfo(matrixToken, minReserveReceiveQuantity, redeemInfo);
        matrixToken.burn(msg.sender, matrixTokenQuantity);

        // Instruct the MatrixToken to transfer the reserve asset back to the user
        matrixToken.invokeExactSafeTransfer(reserveAsset, to, redeemInfo.netFlowQuantity);
        _handleRedemptionFees(matrixToken, reserveAsset, redeemInfo);
        _handleRedeemStateUpdates(matrixToken, reserveAsset, to, redeemInfo);
    }

    /**
     * @dev Redeems a MatrixToken into Ether (if WETH is valid) representing the appropriate % of Net Asset Value of
     * the MatrixToken to the specified _to address. Only valid if there are available WETH units on the MatrixToken.
     *
     * @param matrixToken                  Instance of the MatrixToken contract
     * @param matrixTokenQuantity          Quantity of MatrixToken to redeem
     * @param minReserveReceiveQuantity    Min quantity of reserve asset to receive
     * @param to                           Address to redeem reserve asset to
     */
    function redeemIntoEther(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        uint256 minReserveReceiveQuantity,
        address payable to
    ) external nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        _validateCommon(matrixToken, address(_weth), matrixTokenQuantity);
        _callPreRedeemHooks(matrixToken, matrixTokenQuantity, msg.sender, to);
        ActionInfo memory redeemInfo = _createRedemptionInfo(matrixToken, address(_weth), matrixTokenQuantity);
        _validateRedemptionInfo(matrixToken, minReserveReceiveQuantity, redeemInfo);
        matrixToken.burn(msg.sender, matrixTokenQuantity);

        // Instruct the MatrixToken to transfer WETH from MatrixToken to module
        matrixToken.invokeExactSafeTransfer(address(_weth), address(this), redeemInfo.netFlowQuantity);
        _weth.withdraw(redeemInfo.netFlowQuantity);
        to.transfer(redeemInfo.netFlowQuantity);
        _handleRedemptionFees(matrixToken, address(_weth), redeemInfo);
        _handleRedeemStateUpdates(matrixToken, address(_weth), to, redeemInfo);
    }

    /**
     * @dev Add an allowed reserve asset
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param reserveAsset    Address of the reserve asset to add
     */
    function addReserveAsset(IMatrixToken matrixToken, address reserveAsset) external onlyManagerAndValidMatrix(matrixToken) {
        _addReserveAsset(matrixToken, reserveAsset);
    }

    function batchAddReserveAsset(IMatrixToken matrixToken, address[] memory reserveAssets) external onlyManagerAndValidMatrix(matrixToken) {
        _batchAddReserveAsset(matrixToken, reserveAssets);
    }

    /**
     * @dev Remove a reserve asset
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param reserveAsset    Address of the reserve asset to remove
     */
    function removeReserveAsset(IMatrixToken matrixToken, address reserveAsset) external onlyManagerAndValidMatrix(matrixToken) {
        _removeReserveAsset(matrixToken, reserveAsset);
    }

    function batchRemoveReserveAsset(IMatrixToken matrixToken, address[] memory reserveAssets) external onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < reserveAssets.length; i++) {
            _removeReserveAsset(matrixToken, reserveAssets[i]);
        }
    }

    function setReserveAsset(IMatrixToken matrixToken, address[] memory reserveAssets) external onlyManagerAndValidMatrix(matrixToken) {
        IssuanceSetting memory oldIssuanceSetting = _issuanceSettings[matrixToken];

        require(!oldIssuanceSetting.reserveAssets.equal(reserveAssets), "N1");

        _setReserveAsset(matrixToken, reserveAssets);
    }

    /**
     * @dev Edit the premium percentage
     *
     * @param matrixToken          Instance of the MatrixToken
     * @param premiumPercentage    Premium percentage in 10e16 (e.g. 10e16 = 1%)
     */
    function editPremium(IMatrixToken matrixToken, uint256 premiumPercentage) external onlyManagerAndValidMatrix(matrixToken) {
        _editPremium(matrixToken, premiumPercentage);
    }

    /**
     * @dev Edit manager fee
     *
     * @param matrixToken             Instance of the MatrixToken
     * @param managerFeePercentage    Manager fee percentage in 10e16 (e.g. 10e16 = 1%)
     * @param managerFeeIndex         Manager fee index. 0 index is issue fee, 1 index is redeem fee
     */
    function editManagerFee(
        IMatrixToken matrixToken,
        uint256 managerFeePercentage,
        uint256 managerFeeIndex
    ) external onlyManagerAndValidMatrix(matrixToken) {
        _editManagerFee(matrixToken, managerFeePercentage, managerFeeIndex);
    }

    /**
     * @dev Edit the manager fee recipient
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param managerFeeRecipient    Manager fee recipient
     */
    function editFeeRecipient(IMatrixToken matrixToken, address managerFeeRecipient) external onlyManagerAndValidMatrix(matrixToken) {
        _editFeeRecipient(matrixToken, managerFeeRecipient);
    }

    function editIssuanceSetting(IMatrixToken matrixToken, IssuanceSetting memory newIssuanceSetting) external onlyManagerAndValidMatrix(matrixToken) {
        IssuanceSetting memory oldIssuanceSetting = _issuanceSettings[matrixToken];

        if (!oldIssuanceSetting.reserveAssets.equal(newIssuanceSetting.reserveAssets)) {
            _setReserveAsset(matrixToken, newIssuanceSetting.reserveAssets);
        }

        if (oldIssuanceSetting.premiumPercentage != newIssuanceSetting.premiumPercentage) {
            _editPremium(matrixToken, newIssuanceSetting.premiumPercentage);
        }

        if (oldIssuanceSetting.managerFees[0] != newIssuanceSetting.managerFees[0]) {
            _editManagerFee(matrixToken, newIssuanceSetting.managerFees[0], 0);
        }

        if (oldIssuanceSetting.managerFees[1] != newIssuanceSetting.managerFees[1]) {
            _editManagerFee(matrixToken, newIssuanceSetting.managerFees[1], 1);
        }

        if (oldIssuanceSetting.feeRecipient != newIssuanceSetting.feeRecipient) {
            _editFeeRecipient(matrixToken, newIssuanceSetting.feeRecipient);
        }
    }

    // ==================== Internal functions ====================

    function _addReserveAsset(IMatrixToken matrixToken, address reserveAsset) internal {
        require(!_isReserveAssets[matrixToken][reserveAsset], "N2"); // "Reserve asset already exists"

        _issuanceSettings[matrixToken].reserveAssets.push(reserveAsset);
        _isReserveAssets[matrixToken][reserveAsset] = true;

        emit AddReserveAsset(matrixToken, reserveAsset);
    }

    function _batchAddReserveAsset(IMatrixToken matrixToken, address[] memory reserveAssets) internal {
        require(reserveAssets.length > 0, "N3"); // "Reserve assets must be greater than 0"

        for (uint256 i = 0; i < reserveAssets.length; i++) {
            _addReserveAsset(matrixToken, reserveAssets[i]);
        }
    }

    function _removeReserveAsset(IMatrixToken matrixToken, address reserveAsset) internal {
        require(_isReserveAssets[matrixToken][reserveAsset], "N4"); // "Reserve asset does not exist"

        _issuanceSettings[matrixToken].reserveAssets.quickRemoveItem(reserveAsset);
        delete _isReserveAssets[matrixToken][reserveAsset];

        emit RemoveReserveAsset(matrixToken, reserveAsset);
    }

    function _setReserveAsset(IMatrixToken matrixToken, address[] memory reserveAssets) internal {
        address[] memory oldReserveAssets = _issuanceSettings[matrixToken].reserveAssets;

        for (uint256 i = 0; i < oldReserveAssets.length; i++) {
            delete _isReserveAssets[matrixToken][oldReserveAssets[i]];

            emit RemoveReserveAsset(matrixToken, oldReserveAssets[i]);
        }

        delete _issuanceSettings[matrixToken].reserveAssets;

        _batchAddReserveAsset(matrixToken, reserveAssets);
    }

    function _editPremium(IMatrixToken matrixToken, uint256 premiumPercentage) internal {
        require(premiumPercentage <= _issuanceSettings[matrixToken].maxPremiumPercentage, "N5"); // "Premium must be less than maximum allowed"

        _issuanceSettings[matrixToken].premiumPercentage = premiumPercentage;

        emit EditPremium(matrixToken, premiumPercentage);
    }

    function _editManagerFee(
        IMatrixToken matrixToken,
        uint256 managerFeePercentage,
        uint256 managerFeeIndex
    ) internal {
        require(managerFeePercentage <= _issuanceSettings[matrixToken].maxManagerFee, "N6"); // "Manager fee must be less than maximum allowed"

        _issuanceSettings[matrixToken].managerFees[managerFeeIndex] = managerFeePercentage;

        emit EditManagerFee(matrixToken, managerFeePercentage, managerFeeIndex);
    }

    function _editFeeRecipient(IMatrixToken matrixToken, address managerFeeRecipient) internal {
        require(managerFeeRecipient != address(0), "N7"); // "Fee recipient must not be 0 address"

        _issuanceSettings[matrixToken].feeRecipient = managerFeeRecipient;

        emit EditFeeRecipient(matrixToken, managerFeeRecipient);
    }

    function _validateCommon(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 quantity
    ) internal view {
        require(quantity > 0, "N8a"); // "Quantity must be > 0"
        require(_isReserveAssets[matrixToken][reserveAsset], "N8b"); // "Must be valid reserve asset"
    }

    function _validateIssuanceInfo(
        IMatrixToken matrixToken,
        uint256 minMatrixTokenReceiveQuantity,
        ActionInfo memory issueInfo
    ) internal view {
        // Check that total supply is greater than min supply needed for issuance
        // Note: A min supply amount is needed to avoid division by 0 when MatrixToken supply is 0
        require(issueInfo.previousMatrixTokenSupply >= _issuanceSettings[matrixToken].minMatrixTokenSupply, "N9a"); // "Supply must be greater than minimum to enable issuance"
        require(issueInfo.matrixTokenQuantity >= minMatrixTokenReceiveQuantity, "N9b"); // "Must be greater than min MatrixToken"
    }

    function _validateRedemptionInfo(
        IMatrixToken matrixToken,
        uint256 minReserveReceiveQuantity,
        ActionInfo memory redeemInfo
    ) internal view {
        // Check that new supply is more than min supply needed for redemption
        // Note: A min supply amount is needed to avoid division by 0 when redeeming MatrixToken to 0
        require(redeemInfo.newMatrixTokenSupply >= _issuanceSettings[matrixToken].minMatrixTokenSupply, "N10a"); // "Supply must be greater than minimum to enable redemption"
        require(redeemInfo.netFlowQuantity >= minReserveReceiveQuantity, "N10b"); // "Must be greater than min receive reserve quantity"
    }

    function _createIssuanceInfo(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity
    ) internal view returns (ActionInfo memory) {
        ActionInfo memory issueInfo;
        issueInfo.previousMatrixTokenSupply = matrixToken.totalSupply();
        issueInfo.preFeeReserveQuantity = reserveAssetQuantity;

        (issueInfo.protocolFees, issueInfo.managerFee, issueInfo.netFlowQuantity) = _getFees(
            matrixToken,
            issueInfo.preFeeReserveQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        issueInfo.matrixTokenQuantity = _getMatrixTokenMintQuantity(matrixToken, reserveAsset, issueInfo.netFlowQuantity, issueInfo.previousMatrixTokenSupply);
        (issueInfo.newMatrixTokenSupply, issueInfo.newPositionMultiplier) = _getIssuePositionMultiplier(matrixToken, issueInfo);
        issueInfo.newReservePositionUnit = _getIssuePositionUnit(matrixToken, reserveAsset, issueInfo);

        return issueInfo;
    }

    function _createRedemptionInfo(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) internal view returns (ActionInfo memory) {
        ActionInfo memory redeemInfo;
        redeemInfo.previousMatrixTokenSupply = matrixToken.totalSupply();
        redeemInfo.matrixTokenQuantity = matrixTokenQuantity;
        redeemInfo.preFeeReserveQuantity = _getRedeemReserveQuantity(matrixToken, reserveAsset, matrixTokenQuantity);

        (redeemInfo.protocolFees, redeemInfo.managerFee, redeemInfo.netFlowQuantity) = _getFees(
            matrixToken,
            redeemInfo.preFeeReserveQuantity,
            PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
            MANAGER_REDEEM_FEE_INDEX
        );

        (redeemInfo.newMatrixTokenSupply, redeemInfo.newPositionMultiplier) = _getRedeemPositionMultiplier(matrixToken, matrixTokenQuantity, redeemInfo);
        redeemInfo.newReservePositionUnit = _getRedeemPositionUnit(matrixToken, reserveAsset, redeemInfo);

        return redeemInfo;
    }

    /**
     * @dev Transfer reserve asset from user to MatrixToken and fees from user to appropriate fee recipients
     */
    function _transferCollateralAndHandleFees(
        IMatrixToken matrixToken,
        IERC20 reserveAsset,
        ActionInfo memory issueInfo
    ) internal {
        reserveAsset.exactSafeTransferFrom(msg.sender, address(matrixToken), issueInfo.netFlowQuantity);

        if (issueInfo.protocolFees > 0) {
            reserveAsset.exactSafeTransferFrom(msg.sender, _controller.getFeeRecipient(), issueInfo.protocolFees);
        }

        if (issueInfo.managerFee > 0) {
            reserveAsset.exactSafeTransferFrom(msg.sender, _issuanceSettings[matrixToken].feeRecipient, issueInfo.managerFee);
        }
    }

    /**
     * @dev Transfer WETH from module to MatrixToken and fees from module to appropriate fee recipients
     */
    function _transferWethAndHandleFees(IMatrixToken matrixToken, ActionInfo memory issueInfo) internal {
        _weth.transfer(address(matrixToken), issueInfo.netFlowQuantity);

        if (issueInfo.protocolFees > 0) {
            _weth.transfer(_controller.getFeeRecipient(), issueInfo.protocolFees);
        }

        if (issueInfo.managerFee > 0) {
            _weth.transfer(_issuanceSettings[matrixToken].feeRecipient, issueInfo.managerFee);
        }
    }

    function _handleIssueStateUpdates(
        IMatrixToken matrixToken,
        address reserveAsset,
        address to,
        ActionInfo memory issueInfo
    ) internal {
        matrixToken.editPositionMultiplier(issueInfo.newPositionMultiplier);
        matrixToken.editDefaultPosition(reserveAsset, issueInfo.newReservePositionUnit);
        matrixToken.mint(to, issueInfo.matrixTokenQuantity);

        emit IssueMatrixTokenNav(
            matrixToken,
            msg.sender,
            to,
            reserveAsset,
            address(_issuanceSettings[matrixToken].managerIssuanceHook),
            issueInfo.matrixTokenQuantity,
            issueInfo.managerFee,
            issueInfo.protocolFees
        );
    }

    function _handleRedeemStateUpdates(
        IMatrixToken matrixToken,
        address reserveAsset,
        address to,
        ActionInfo memory redeemInfo
    ) internal {
        matrixToken.editPositionMultiplier(redeemInfo.newPositionMultiplier);
        matrixToken.editDefaultPosition(reserveAsset, redeemInfo.newReservePositionUnit);

        emit RedeemMatrixTokenNav(
            matrixToken,
            msg.sender,
            to,
            reserveAsset,
            address(_issuanceSettings[matrixToken].managerRedemptionHook),
            redeemInfo.matrixTokenQuantity,
            redeemInfo.managerFee,
            redeemInfo.protocolFees
        );
    }

    function _handleRedemptionFees(
        IMatrixToken matrixToken,
        address reserveAsset,
        ActionInfo memory redeemInfo
    ) internal {
        // Instruct the MatrixToken to transfer protocol fee to fee recipient if there is a fee
        payProtocolFeeFromMatrixToken(matrixToken, reserveAsset, redeemInfo.protocolFees);

        // Instruct the MatrixToken to transfer manager fee to manager fee recipient if there is a fee
        if (redeemInfo.managerFee > 0) {
            matrixToken.invokeExactSafeTransfer(reserveAsset, _issuanceSettings[matrixToken].feeRecipient, redeemInfo.managerFee);
        }
    }

    /**
     * @dev Returns the issue premium percentage. Virtual function that can be overridden
     * in future versions of the module and can contain arbitrary logic to calculate the issuance premium.
     */
    function _getIssuePremium(
        IMatrixToken matrixToken,
        address, /* reserveAsset */
        uint256 /* _reserveAssetQuantity */
    ) internal view virtual returns (uint256) {
        return _issuanceSettings[matrixToken].premiumPercentage;
    }

    /**
     * @dev Returns the redeem premium percentage. Virtual function that can be overridden
     * in future versions of the module and can contain arbitrary logic to calculate the redemption premium.
     */
    function _getRedeemPremium(
        IMatrixToken matrixToken,
        address, /* reserveAsset */
        uint256 /* matrixTokenQuantity */
    ) internal view virtual returns (uint256) {
        return _issuanceSettings[matrixToken].premiumPercentage;
    }

    /**
     * @dev Returns the fees attributed to the manager and the protocol. The fees are calculated as follows:
     * ManagerFee = (manager fee % - % to protocol) * reserveAssetQuantity
     * Protocol Fee = (% manager fee share + direct fee %) * reserveAssetQuantity
     *
     * @param matrixToken                Instance of the MatrixToken
     * @param reserveAssetQuantity       Quantity of reserve asset to calculate fees from
     * @param protocolManagerFeeIndex    Index to pull rev share NAV Issuance fee from the Controller
     * @param protocolDirectFeeIndex     Index to pull direct NAV issuance fee from the Controller
     * @param managerFeeIndex            Index from IssuanceSetting (0 = issue fee, 1 = redeem fee)
     *
     * @return uint256                   Fees paid to the protocol in reserve asset
     * @return uint256                   Fees paid to the manager in reserve asset
     * @return uint256                   Net reserve to user net of fees
     */
    function _getFees(
        IMatrixToken matrixToken,
        uint256 reserveAssetQuantity,
        uint256 protocolManagerFeeIndex,
        uint256 protocolDirectFeeIndex,
        uint256 managerFeeIndex
    )
        internal
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        (uint256 protocolFeePercentage, uint256 managerFeePercentage) = _getProtocolAndManagerFeePercentages(
            matrixToken,
            protocolManagerFeeIndex,
            protocolDirectFeeIndex,
            managerFeeIndex
        );

        // Calculate total notional fees
        uint256 protocolFees = protocolFeePercentage.preciseMul(reserveAssetQuantity);
        uint256 managerFee = managerFeePercentage.preciseMul(reserveAssetQuantity);
        uint256 netReserveFlow = reserveAssetQuantity - protocolFees - managerFee;

        return (protocolFees, managerFee, netReserveFlow);
    }

    function _getProtocolAndManagerFeePercentages(
        IMatrixToken matrixToken,
        uint256 protocolManagerFeeIndex,
        uint256 protocolDirectFeeIndex,
        uint256 managerFeeIndex
    ) internal view returns (uint256, uint256) {
        // Get protocol fee percentages
        uint256 protocolDirectFeePercent = _controller.getModuleFee(address(this), protocolDirectFeeIndex);
        uint256 protocolManagerShareFeePercent = _controller.getModuleFee(address(this), protocolManagerFeeIndex);
        uint256 managerFeePercent = _issuanceSettings[matrixToken].managerFees[managerFeeIndex];

        // Calculate revenue share split percentage
        uint256 protocolRevenueSharePercentage = protocolManagerShareFeePercent.preciseMul(managerFeePercent);
        uint256 managerRevenueSharePercentage = managerFeePercent - protocolRevenueSharePercentage;
        uint256 totalProtocolFeePercentage = protocolRevenueSharePercentage + protocolDirectFeePercent;

        return (totalProtocolFeePercentage, managerRevenueSharePercentage);
    }

    function _getMatrixTokenMintQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 netReserveFlows, // Value of reserve asset net of fees
        uint256 totalSupply
    ) internal view returns (uint256) {
        // Get valuation of the MatrixToken with the quote asset as the reserve asset. Reverts if price is not found
        uint256 matrixTokenValuation = _controller.getMatrixValuer().calculateMatrixTokenValuation(matrixToken, reserveAsset);

        uint256 premiumPercentage = _getIssuePremium(matrixToken, reserveAsset, netReserveFlows);
        uint256 premiumValue = netReserveFlows.preciseMul(premiumPercentage);
        uint256 reserveAssetDecimals = ERC20(reserveAsset).decimals();
        uint256 denominator = totalSupply.preciseMul(matrixTokenValuation).preciseMul(10**reserveAssetDecimals) + premiumValue;

        return (netReserveFlows - premiumValue).preciseMul(totalSupply).preciseDiv(denominator);
    }

    function _getRedeemReserveQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) internal view returns (uint256) {
        // Get valuation of the MatrixToken with the quote asset as the reserve asset. Returns value in precise units (10e18). Reverts if price is not found
        uint256 matrixTokenValuation = _controller.getMatrixValuer().calculateMatrixTokenValuation(matrixToken, reserveAsset);
        uint256 totalRedeemValueInPreciseUnits = matrixTokenQuantity.preciseMul(matrixTokenValuation);

        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(reserveAsset).decimals();
        uint256 prePremiumReserveQuantity = totalRedeemValueInPreciseUnits.preciseMul(10**reserveAssetDecimals);
        uint256 premiumPercentage = _getRedeemPremium(matrixToken, reserveAsset, matrixTokenQuantity);
        uint256 premiumQuantity = prePremiumReserveQuantity.preciseMulCeil(premiumPercentage);

        return prePremiumReserveQuantity - premiumQuantity;
    }

    /**
     * @dev The new position multiplier is calculated as follows:
     * inflationPercentage = (newSupply - oldSupply) / newSupply
     * newMultiplier = (1 - inflationPercentage) * positionMultiplier = oldSupply * positionMultiplier / newSupply
     */
    function _getIssuePositionMultiplier(IMatrixToken matrixToken, ActionInfo memory issueInfo) internal view returns (uint256, int256) {
        // Calculate inflation and new position multiplier. Note: Round inflation up in order to round position multiplier down
        uint256 newTotalSupply = issueInfo.matrixTokenQuantity + issueInfo.previousMatrixTokenSupply;
        int256 newPositionMultiplier = (issueInfo.previousMatrixTokenSupply.toInt256() * matrixToken.getPositionMultiplier()) / newTotalSupply.toInt256();

        return (newTotalSupply, newPositionMultiplier);
    }

    /**
     * @dev Calculate deflation and new position multiplier. The new position multiplier is calculated as follows:
     * deflationPercentage = (oldSupply - newSupply) / newSupply
     * newMultiplier = (1 + deflationPercentage) * positionMultiplier = oldSupply * positionMultiplier / newSupply
     *
     * @notice Round deflation down in order to round position multiplier down
     */
    function _getRedeemPositionMultiplier(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        ActionInfo memory redeemInfo
    ) internal view returns (uint256, int256) {
        uint256 newTotalSupply = redeemInfo.previousMatrixTokenSupply - matrixTokenQuantity;
        int256 newPositionMultiplier = (matrixToken.getPositionMultiplier() * redeemInfo.previousMatrixTokenSupply.toInt256()) / newTotalSupply.toInt256();

        return (newTotalSupply, newPositionMultiplier);
    }

    /**
     * @dev The new position reserve asset unit is calculated as follows:
     * totalReserve = (oldUnit * oldMatrixTokenSupply) + reserveQuantity
     * newUnit = totalReserve / newMatrixTokenSupply
     */
    function _getIssuePositionUnit(
        IMatrixToken matrixToken,
        address reserveAsset,
        ActionInfo memory issueInfo
    ) internal view returns (uint256) {
        uint256 existingUnit = matrixToken.getDefaultPositionRealUnit(reserveAsset).toUint256();
        uint256 totalReserve = existingUnit.preciseMul(issueInfo.previousMatrixTokenSupply) + issueInfo.netFlowQuantity;

        return totalReserve.preciseDiv(issueInfo.newMatrixTokenSupply);
    }

    /**
     * @dev The new position reserve asset unit is calculated as follows:
     * totalReserve = (oldUnit * oldMatrixTokenSupply) - reserveQuantityToSendOut
     * newUnit = totalReserve / newMatrixTokenSupply
     */
    function _getRedeemPositionUnit(
        IMatrixToken matrixToken,
        address reserveAsset,
        ActionInfo memory redeemInfo
    ) internal view returns (uint256) {
        uint256 existingUnit = matrixToken.getDefaultPositionRealUnit(reserveAsset).toUint256();
        uint256 totalExistingUnits = existingUnit.preciseMul(redeemInfo.previousMatrixTokenSupply);
        uint256 outflow = redeemInfo.netFlowQuantity + redeemInfo.protocolFees + redeemInfo.managerFee;

        // Require withdrawable quantity is greater than existing collateral
        require(totalExistingUnits >= outflow, "N11"); // "Must be greater than total available collateral"

        return (totalExistingUnits - outflow).preciseDiv(redeemInfo.newMatrixTokenSupply);
    }

    /**
     * @dev If a pre-issue hook has been configured, call the external-protocol contract. Pre-issue hook logic
     * can contain arbitrary logic including validations, external function calls, etc.
     */
    function _callPreIssueHooks(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity,
        address caller,
        address to
    ) internal {
        INavIssuanceHook preIssueHook = _issuanceSettings[matrixToken].managerIssuanceHook;

        if (address(preIssueHook) != address(0)) {
            preIssueHook.invokePreIssueHook(matrixToken, reserveAsset, reserveAssetQuantity, caller, to);
        }
    }

    /**
     * @dev If a pre-redeem hook has been configured, call the external-protocol contract.
     */
    function _callPreRedeemHooks(
        IMatrixToken matrixToken,
        uint256 setQuantity,
        address caller,
        address to
    ) internal {
        INavIssuanceHook preRedeemHook = _issuanceSettings[matrixToken].managerRedemptionHook;

        if (address(preRedeemHook) != address(0)) {
            preRedeemHook.invokePreRedeemHook(matrixToken, setQuantity, caller, to);
        }
    }
}
