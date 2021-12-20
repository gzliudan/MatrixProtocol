// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IMatrixValuer } from "../../interfaces/IMatrixValuer.sol";
import { INavIssuanceHook } from "../../interfaces/INavIssuanceHook.sol";

/**
 * @title CustomOracleNavIssuanceModule
 *
 * @dev Module that enables issuance and redemption with any valid ERC20 token or ETH if allowed by the manager.
 * Sender receives a proportional amount of MatrixToken on issuance or ERC20 token on redemption based on
 * the calculated net asset value using oracle prices. Manager is able to enforce a premium / discount on
 * issuance / redemption to avoid arbitrage and front running when relying on oracle prices.
 * Managers can charge a fee (denominated in reserve asset).
 */
contract CustomOracleNavIssuanceModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using PositionUtil for IMatrixToken;

    // ==================== Constants ====================

    // 0 index stores the manager fee in managerFees array, percentage charged on issue (denominated in reserve asset)
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
     * @dev Premium is a buffer around oracle prices paid by user to the MatrixToken, which prevents arbitrage and oracle front running.
     */
    struct NavIssuanceSetting {
        uint256 maxManagerFee; // Maximum fee manager is allowed to set for issue and redeem
        uint256 premiumPercentage; // Premium percentage (0.01% = 1e14, 1% = 1e16).
        uint256 maxPremiumPercentage; // Maximum premium percentage manager is allowed to set (configured by manager)
        uint256 minMatrixTokenSupply; // Minimum required for issuance and redemption to prevent dramatic inflationary changes to the MatrixToken's position multiplier
        address feeRecipient; // Manager fee recipient
        INavIssuanceHook managerIssuanceHook; // Issuance hook configurations
        INavIssuanceHook managerRedemptionHook; // Redemption hook configurations
        IMatrixValuer matrixValuer; // Optional custom matrix valuer. If address(0) is provided, fetch the default one from the controller
        uint256[2] managerFees; // Manager fees. 0 index is issue and 1 index is redeem fee (0.01% = 1e14, 1% = 1e16)
        address[] reserveAssets; // Allowed reserve assets - Must have a price enabled with the price oracle
    }

    struct ActionInfo {
        uint256 preFeeReserveQuantity; // Reserve value before fees; During issuance, represents raw quantity; During redeem, represents post-premium value
        uint256 protocolFees; // Total protocol fees (direct + manager revenue share)
        uint256 managerFee; // Total manager fee paid in reserve asset
        uint256 netFlowQuantity; // When issuing, quantity of reserve asset sent to MatrixToken; When redeeming, quantity of reserve asset sent to redeemer
        uint256 matrixTokenQuantity; // When issuing, quantity of MatrixToken minted to mintee; When redeeming, quantity of MatrixToken redeemed
        uint256 previousMatrixTokenSupply; // MatrixToken supply prior to issue/redeem action
        uint256 newMatrixTokenSupply; // MatrixToken supply after issue/redeem action
        uint256 newReservePositionUnit; // MatrixToken reserve asset position unit after issue/redeem
        int256 newPositionMultiplier; // MatrixToken position multiplier after issue/redeem
    }

    // ==================== Variables ====================

    // Wrapped ETH address
    IWETH public immutable _weth;

    // Mapping of MatrixToken to NAV issuance settings struct
    mapping(IMatrixToken => NavIssuanceSetting) public _navIssuanceSettings;

    // MatrixToken => reserveAsset => isReserved, check a MatrixToken's reserve asset validity
    mapping(IMatrixToken => mapping(address => bool)) public _isReserveAssets;

    // ==================== Events ====================

    event IssueMatrixTokenNav(
        IMatrixToken indexed matrixToken,
        address indexed issuer,
        address indexed to,
        address reserveAsset,
        address hookContract,
        uint256 matrixTokenQuantity,
        uint256 managerFee,
        uint256 premium
    );

    event RedeemMatrixTokenNav(
        IMatrixToken indexed matrixToken,
        address indexed redeemer,
        address indexed to,
        address reserveAsset,
        address hookContract,
        uint256 matrixTokenQuantity,
        uint256 managerFee,
        uint256 premium
    );

    event AddReserveAsset(IMatrixToken indexed matrixToken, address indexed newReserveAsset);
    event RemoveReserveAsset(IMatrixToken indexed matrixToken, address indexed removedReserveAsset);
    event EditPremium(IMatrixToken indexed matrixToken, uint256 newPremium);
    event EditManagerFee(IMatrixToken indexed matrixToken, uint256 newManagerFee, uint256 index);
    event EditFeeRecipient(IMatrixToken indexed matrixToken, address indexed feeRecipient);

    // ==================== Constructor function ====================

    constructor(IController controller, IWETH weth) ModuleBase(controller) {
        _weth = weth;
    }

    // ==================== Receive function ====================

    receive() external payable {}

    // ==================== External functions ====================

    function getReserveAssets(IMatrixToken matrixToken) external view returns (address[] memory) {
        return _navIssuanceSettings[matrixToken].reserveAssets;
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
        return _navIssuanceSettings[matrixToken].managerFees[managerFeeIndex];
    }

    /**
     * @dev Get the expected MatrixToken minted to recipient on issuance
     *
     * @param matrixToken             Instance of the MatrixToken
     * @param reserveAsset            Address of the reserve asset
     * @param reserveAssetQuantity    Quantity of the reserve asset to issue with
     *
     * @return uint256                Expected MatrixToken to be minted to recipient
     */
    function getExpectedMatrixTokenIssueQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity
    ) external view returns (uint256) {
        (, , uint256 netReserveFlow) = _getFees(
            matrixToken,
            reserveAssetQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        uint256 matrixTotalSupply = matrixToken.totalSupply();

        return _getMatrixTokenMintQuantity(matrixToken, reserveAsset, netReserveFlow, matrixTotalSupply);
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
        uint256 matrixTotalSupply = matrixToken.totalSupply();

        return
            reserveAssetQuantity != 0 &&
            _isReserveAssets[matrixToken][reserveAsset] &&
            matrixTotalSupply >= _navIssuanceSettings[matrixToken].minMatrixTokenSupply;
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
        uint256 matrixTotalSupply = matrixToken.totalSupply();

        if (
            matrixTokenQuantity == 0 ||
            !_isReserveAssets[matrixToken][reserveAsset] ||
            matrixTotalSupply < _navIssuanceSettings[matrixToken].minMatrixTokenSupply + matrixTokenQuantity
        ) {
            return false;
        } else {
            uint256 totalRedeemValue = _getRedeemReserveQuantity(matrixToken, reserveAsset, matrixTokenQuantity);

            (, , uint256 expectedRedeemQuantity) = _getFees(
                matrixToken,
                totalRedeemValue,
                PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
                PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
                MANAGER_REDEEM_FEE_INDEX
            );

            uint256 existingUnit = matrixToken.getDefaultPositionRealUnit(reserveAsset).toUint256();

            return existingUnit.preciseMul(matrixTotalSupply) >= expectedRedeemQuantity;
        }
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
     * mints the appropriate % of Net Asset Value of the MatrixToken to the specified to address.
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
     * the MatrixToken to the specified to address. Only valid if there are available reserve units on the MatrixToken.
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
     * the MatrixToken to the specified to address. Only valid if there are available WETH units on the MatrixToken.
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
     * @dev MANAGER ONLY. Add an allowed reserve asset
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param reserveAsset    Address of the reserve asset to add
     */
    function addReserveAsset(IMatrixToken matrixToken, address reserveAsset) external onlyManagerAndValidMatrix(matrixToken) {
        require(!_isReserveAssets[matrixToken][reserveAsset], "O0");

        _navIssuanceSettings[matrixToken].reserveAssets.push(reserveAsset);
        _isReserveAssets[matrixToken][reserveAsset] = true;

        emit AddReserveAsset(matrixToken, reserveAsset);
    }

    /**
     * @dev MANAGER ONLY. Remove a reserve asset
     *
     * @param matrixToken     Instance of the MatrixToken
     * @param reserveAsset    Address of the reserve asset to remove
     */
    function removeReserveAsset(IMatrixToken matrixToken, address reserveAsset) external onlyManagerAndValidMatrix(matrixToken) {
        require(_isReserveAssets[matrixToken][reserveAsset], "O1");

        _navIssuanceSettings[matrixToken].reserveAssets.quickRemoveItem(reserveAsset);
        delete _isReserveAssets[matrixToken][reserveAsset];

        emit RemoveReserveAsset(matrixToken, reserveAsset);
    }

    /**
     * @dev MANAGER ONLY. Edit the premium percentage
     *
     * @param matrixToken          Instance of the MatrixToken
     * @param premiumPercentage    Premium percentage in 10e16 (e.g. 10e16 = 1%)
     */
    function editPremium(IMatrixToken matrixToken, uint256 premiumPercentage) external onlyManagerAndValidMatrix(matrixToken) {
        require(premiumPercentage <= _navIssuanceSettings[matrixToken].maxPremiumPercentage, "O2");

        _navIssuanceSettings[matrixToken].premiumPercentage = premiumPercentage;

        emit EditPremium(matrixToken, premiumPercentage);
    }

    /**
     * @dev MANAGER ONLY. Edit manager fee
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
        require(managerFeePercentage <= _navIssuanceSettings[matrixToken].maxManagerFee, "O3");

        _navIssuanceSettings[matrixToken].managerFees[managerFeeIndex] = managerFeePercentage;

        emit EditManagerFee(matrixToken, managerFeePercentage, managerFeeIndex);
    }

    /**
     * @dev MANAGER ONLY. Edit the manager fee recipient
     *
     * @param matrixToken            Instance of the MatrixToken
     * @param managerFeeRecipient    Manager fee recipient
     */
    function editFeeRecipient(IMatrixToken matrixToken, address managerFeeRecipient) external onlyManagerAndValidMatrix(matrixToken) {
        require(managerFeeRecipient != address(0), "O4");

        _navIssuanceSettings[matrixToken].feeRecipient = managerFeeRecipient;

        emit EditFeeRecipient(matrixToken, managerFeeRecipient);
    }

    /**
     * @dev MANAGER ONLY. Initializes this module to the MatrixToken with hooks, allowed reserve assets, fees and issuance premium.
     * Only callable by the MatrixToken's manager. Hook addresses are optional. Address(0) means that no hook will be called.
     *
     * @param matrixToken           Instance of the MatrixToken to issue
     * @param navIssuanceSetting    NavIssuanceSetting struct defining parameters
     */
    function initialize(IMatrixToken matrixToken, NavIssuanceSetting memory navIssuanceSetting)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndPendingMatrix(matrixToken)
    {
        require(navIssuanceSetting.reserveAssets.length > 0, "O5a");
        require(navIssuanceSetting.maxManagerFee < PreciseUnitMath.preciseUnit(), "O5b");
        require(navIssuanceSetting.maxPremiumPercentage < PreciseUnitMath.preciseUnit(), "O5c");
        require(navIssuanceSetting.managerFees[0] <= navIssuanceSetting.maxManagerFee, "O5d");
        require(navIssuanceSetting.managerFees[1] <= navIssuanceSetting.maxManagerFee, "O5e");
        require(navIssuanceSetting.premiumPercentage <= navIssuanceSetting.maxPremiumPercentage, "O5f");
        require(navIssuanceSetting.feeRecipient != address(0), "O5g");

        // Initial mint cannot use NAVIssuance since minMatrixTokenSupply must be > 0
        require(navIssuanceSetting.minMatrixTokenSupply > 0, "O5h");

        for (uint256 i = 0; i < navIssuanceSetting.reserveAssets.length; i++) {
            require(!_isReserveAssets[matrixToken][navIssuanceSetting.reserveAssets[i]], "O5i");
            _isReserveAssets[matrixToken][navIssuanceSetting.reserveAssets[i]] = true;
        }

        _navIssuanceSettings[matrixToken] = navIssuanceSetting;

        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken. Issuance settings and reserve asset states are deleted.
     */
    function removeModule() external override {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);

        for (uint256 i = 0; i < _navIssuanceSettings[matrixToken].reserveAssets.length; i++) {
            delete _isReserveAssets[matrixToken][_navIssuanceSettings[matrixToken].reserveAssets[i]];
        }

        delete _navIssuanceSettings[matrixToken];
    }

    // ==================== Internal functions ====================

    function _validateCommon(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 quantity
    ) internal view {
        require(quantity > 0, "O6a");
        require(_isReserveAssets[matrixToken][reserveAsset], "O6b");
    }

    function _validateIssuanceInfo(
        IMatrixToken matrixToken,
        uint256 minMatrixTokenReceiveQuantity,
        ActionInfo memory issueInfo
    ) internal view {
        // Check that total supply is greater than min supply needed for issuance
        // Note: A min supply amount is needed to avoid division by 0 when MatrixToken supply is 0
        require(issueInfo.previousMatrixTokenSupply >= _navIssuanceSettings[matrixToken].minMatrixTokenSupply, "O7a");
        require(issueInfo.matrixTokenQuantity >= minMatrixTokenReceiveQuantity, "O7b");
    }

    function _validateRedemptionInfo(
        IMatrixToken matrixToken,
        uint256 minReserveReceiveQuantity,
        ActionInfo memory redeemInfo
    ) internal view {
        // Check that new supply is more than min supply needed for redemption
        // Note: A min supply amount is needed to avoid division by 0 when redeeming MatrixToken to 0
        require(redeemInfo.newMatrixTokenSupply >= _navIssuanceSettings[matrixToken].minMatrixTokenSupply, "O8a");
        require(redeemInfo.netFlowQuantity >= minReserveReceiveQuantity, "O8b");
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
        redeemInfo.matrixTokenQuantity = matrixTokenQuantity;
        redeemInfo.preFeeReserveQuantity = _getRedeemReserveQuantity(matrixToken, reserveAsset, matrixTokenQuantity);

        (redeemInfo.protocolFees, redeemInfo.managerFee, redeemInfo.netFlowQuantity) = _getFees(
            matrixToken,
            redeemInfo.preFeeReserveQuantity,
            PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
            MANAGER_REDEEM_FEE_INDEX
        );

        redeemInfo.previousMatrixTokenSupply = matrixToken.totalSupply();
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
        transferFrom(reserveAsset, msg.sender, address(matrixToken), issueInfo.netFlowQuantity);

        if (issueInfo.protocolFees > 0) {
            transferFrom(reserveAsset, msg.sender, _controller.getFeeRecipient(), issueInfo.protocolFees);
        }

        if (issueInfo.managerFee > 0) {
            transferFrom(reserveAsset, msg.sender, _navIssuanceSettings[matrixToken].feeRecipient, issueInfo.managerFee);
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
            _weth.transfer(_navIssuanceSettings[matrixToken].feeRecipient, issueInfo.managerFee);
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
            address(_navIssuanceSettings[matrixToken].managerIssuanceHook),
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
            address(_navIssuanceSettings[matrixToken].managerRedemptionHook),
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
            matrixToken.invokeExactSafeTransfer(reserveAsset, _navIssuanceSettings[matrixToken].feeRecipient, redeemInfo.managerFee);
        }
    }

    /**
     * @dev Returns the issue premium percentage. Virtual function that can be overridden
     * in future versions of the module and can contain arbitrary logic to calculate the issuance premium.
     */
    function _getIssuePremium(
        IMatrixToken matrixToken,
        address, /* reserveAsset */
        uint256 /* reserveAssetQuantity */
    ) internal view virtual returns (uint256) {
        return _navIssuanceSettings[matrixToken].premiumPercentage;
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
        return _navIssuanceSettings[matrixToken].premiumPercentage;
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
     * @param managerFeeIndex            Index from NavIssuanceSetting (0 = issue fee, 1 = redeem fee)
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
        uint256 managerFeePercent = _navIssuanceSettings[matrixToken].managerFees[managerFeeIndex];

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
        uint256 matrixTotalSupply
    ) internal view returns (uint256) {
        uint256 premiumPercentage = _getIssuePremium(matrixToken, reserveAsset, netReserveFlows);
        uint256 premiumValue = netReserveFlows.preciseMul(premiumPercentage);

        // If the matrix manager provided a custom valuer at initialization time, use it. Otherwise get it from the controller
        // Get valuation of the MatrixToken with the quote asset as the reserve asset. Returns value in precise units (1e18)
        // Reverts if price is not found
        uint256 matrixTokenValuation = _getMatrixValuer(matrixToken).calculateMatrixTokenValuation(matrixToken, reserveAsset);

        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(reserveAsset).decimals();
        uint256 normalizedTotalReserveQuantityNetFees = netReserveFlows.preciseDiv(10**reserveAssetDecimals);
        uint256 normalizedTotalReserveQuantityNetFeesAndPremium = (netReserveFlows - premiumValue).preciseDiv(10**reserveAssetDecimals);

        // Calculate MatrixToken to mint to issuer
        uint256 denominator = matrixTotalSupply.preciseMul(matrixTokenValuation) +
            normalizedTotalReserveQuantityNetFees -
            normalizedTotalReserveQuantityNetFeesAndPremium;
        return normalizedTotalReserveQuantityNetFeesAndPremium.preciseMul(matrixTotalSupply).preciseDiv(denominator);
    }

    function _getRedeemReserveQuantity(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 matrixTokenQuantity
    ) internal view returns (uint256) {
        // Get valuation of the MatrixToken with the quote asset as the reserve asset. Returns value in precise units (10e18)
        // Reverts if price is not found
        uint256 matrixTokenValuation = _getMatrixValuer(matrixToken).calculateMatrixTokenValuation(matrixToken, reserveAsset);
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
     * newMultiplier = (1 - inflationPercentage) * positionMultiplier
     */
    function _getIssuePositionMultiplier(IMatrixToken matrixToken, ActionInfo memory issueInfo) internal view returns (uint256, int256) {
        // Calculate inflation and new position multiplier. Note: Round inflation up in order to round position multiplier down
        uint256 newTotalSupply = issueInfo.matrixTokenQuantity + issueInfo.previousMatrixTokenSupply;
        int256 newPositionMultiplier = (matrixToken.getPositionMultiplier() * issueInfo.previousMatrixTokenSupply.toInt256()) / newTotalSupply.toInt256();

        return (newTotalSupply, newPositionMultiplier);
    }

    /**
     * @dev Calculate deflation and new position multiplier. The new position multiplier is calculated as follows:
     * deflationPercentage = (oldSupply - newSupply) / newSupply
     * newMultiplier = (1 + deflationPercentage) * positionMultiplier
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
        require(totalExistingUnits >= outflow, "O9");

        return (totalExistingUnits - outflow).preciseDiv(redeemInfo.newMatrixTokenSupply);
    }

    /**
     * @dev If a pre-issue hook has been configured, call the external-protocol contract.
     * Pre-issue hook logic can contain arbitrary logic including validations, external function calls, etc.
     */
    function _callPreIssueHooks(
        IMatrixToken matrixToken,
        address reserveAsset,
        uint256 reserveAssetQuantity,
        address caller,
        address to
    ) internal {
        INavIssuanceHook preIssueHook = _navIssuanceSettings[matrixToken].managerIssuanceHook;
        if (address(preIssueHook) != address(0)) {
            preIssueHook.invokePreIssueHook(matrixToken, reserveAsset, reserveAssetQuantity, caller, to);
        }
    }

    /**
     * @dev If a pre-redeem hook has been configured, call the external-protocol contract.
     */
    function _callPreRedeemHooks(
        IMatrixToken matrixToken,
        uint256 matrixQuantity,
        address caller,
        address to
    ) internal {
        INavIssuanceHook preRedeemHook = _navIssuanceSettings[matrixToken].managerRedemptionHook;
        if (address(preRedeemHook) != address(0)) {
            preRedeemHook.invokePreRedeemHook(matrixToken, matrixQuantity, caller, to);
        }
    }

    /**
     * @dev If a custom matrix valuer has been configured, use it. Otherwise fetch the default one form the controller.
     */
    function _getMatrixValuer(IMatrixToken matrixToken) internal view returns (IMatrixValuer) {
        IMatrixValuer customValuer = _navIssuanceSettings[matrixToken].matrixValuer;
        return address(customValuer) == address(0) ? _controller.getMatrixValuer() : customValuer;
    }
}
