// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";

/**
 * @title AirdropModule
 *
 * @dev Module that enables managers to absorb tokens sent to the MatrixToken into the token's positions.
 * With each MatrixToken, managers are able to specify:
 * 1) the airdrops they want to include
 * 2) an airdrop fee recipient
 * 3) airdrop fee,
 * 4) whether all users are allowed to trigger an airdrop.
 */
contract AirdropModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];
    using PositionUtil for IMatrixToken;

    // ==================== Constants ====================

    uint256 public constant AIRDROP_MODULE_PROTOCOL_FEE_INDEX = 0;

    // ==================== Structs ====================

    struct AirdropSetting {
        uint256 airdropFee; // Percentage in preciseUnits of airdrop sent to feeRecipient (1e16 = 1%)
        address feeRecipient; // Address airdrop fees are sent to
        bool anyoneAbsorb; // Boolean indicating if any address can call absorb or just the manager
        address[] airdrops; // Array of tokens manager is allowing to be absorbed
    }

    // ==================== Variables ====================

    mapping(IMatrixToken => AirdropSetting) internal _airdropSettings;

    // Whether a token allow airdrop
    mapping(IMatrixToken => mapping(IERC20 => bool)) internal _isAirdrop;

    // ==================== Events ====================

    event AbsorbComponent(IMatrixToken indexed matrixToken, IERC20 indexed absorbedToken, uint256 absorbedQuantity, uint256 managerFee, uint256 protocolFee);
    event AddAirdropComponent(IMatrixToken indexed matrixToken, IERC20 indexed component);
    event RemoveAirdropComponent(IMatrixToken indexed matrixToken, IERC20 indexed component);
    event UpdateAnyoneAbsorb(IMatrixToken indexed matrixToken, bool anyoneAbsorb);
    event UpdateAirdropFee(IMatrixToken indexed matrixToken, uint256 newFee);
    event UpdateFeeRecipient(IMatrixToken indexed matrixToken, address newFeeRecipient);

    // ==================== Constructor function ====================

    constructor(IController controller) ModuleBase(controller) {}

    // ==================== Modifier functions ====================

    modifier onlyValidCaller(IMatrixToken matrixToken) {
        _onlyValidCaller(matrixToken);
        _;
    }

    // ==================== External functions ====================

    function getAirdropSetting(IMatrixToken matrixToken) external view returns (AirdropSetting memory) {
        return _airdropSettings[matrixToken];
    }

    /**
     * @dev Absorb specified token into position. If airdropFee defined, send portion to feeRecipient and portion to
     * protocol feeRecipient address. Callable only by manager unless manager has set anyoneAbsorb to true.
     *
     * @param matrixToken    Address of MatrixToken
     * @param token          Address of token to absorb
     */
    function absorb(IMatrixToken matrixToken, IERC20 token) external nonReentrant onlyValidCaller(matrixToken) onlyValidAndInitializedMatrix(matrixToken) {
        _absorb(matrixToken, token);
    }

    /**
     * @dev Absorb passed tokens into respective positions. If airdropFee defined, send portion to feeRecipient and portion to
     * protocol feeRecipient address. Callable only by manager unless manager has set anyoneAbsorb to true.
     *
     * @param matrixToken    Address of MatrixToken
     * @param tokens         Array of tokens to absorb
     */
    function batchAbsorb(IMatrixToken matrixToken, address[] memory tokens)
        external
        nonReentrant
        onlyValidCaller(matrixToken)
        onlyValidAndInitializedMatrix(matrixToken)
    {
        _batchAbsorb(matrixToken, tokens);
    }

    /**
     * @dev Adds new tokens to be added to positions when absorb is called.
     *
     * @param matrixToken     Address of MatrixToken
     * @param airdropToken    Component to add to airdrop list
     */
    function addAirdrop(IMatrixToken matrixToken, IERC20 airdropToken) external onlyManagerAndValidMatrix(matrixToken) {
        _addAirdrop(matrixToken, airdropToken);
    }

    function batchAddAirdrop(IMatrixToken matrixToken, IERC20[] memory airdropTokens) external onlyManagerAndValidMatrix(matrixToken) {
        _batchAddAirdrop(matrixToken, airdropTokens);
    }

    function setAirdropTokens(IMatrixToken matrixToken, IERC20[] memory airdropTokens) external onlyManagerAndValidMatrix(matrixToken) {
        address[] memory oldAirdropTokens = _airdropSettings[matrixToken].airdrops;

        for (uint256 i = 0; i < oldAirdropTokens.length; i++) {
            _isAirdrop[matrixToken][IERC20(oldAirdropTokens[i])] = false;
            emit RemoveAirdropComponent(matrixToken, IERC20(oldAirdropTokens[i]));
        }

        delete _airdropSettings[matrixToken].airdrops;

        _batchAddAirdrop(matrixToken, airdropTokens);
    }

    /**
     * @dev Removes token from list to be absorbed.
     *
     * @param matrixToken     Address of MatrixToken
     * @param airdropToken    Component to remove from airdrop list
     */
    function removeAirdrop(IMatrixToken matrixToken, IERC20 airdropToken) external onlyManagerAndValidMatrix(matrixToken) {
        _removeAirdrop(matrixToken, airdropToken);
    }

    function batchRemoveAirdrop(IMatrixToken matrixToken, IERC20[] memory airdropTokens) external onlyManagerAndValidMatrix(matrixToken) {
        for (uint256 i = 0; i < airdropTokens.length; i++) {
            _removeAirdrop(matrixToken, airdropTokens[i]);
        }
    }

    /**
     * @dev Update whether manager allows other addresses to call absorb.
     *
     * @param matrixToken    Address of MatrixToken
     */
    function updateAnyoneAbsorb(IMatrixToken matrixToken, bool anyoneAbsorb) external onlyManagerAndValidMatrix(matrixToken) {
        _airdropSettings[matrixToken].anyoneAbsorb = anyoneAbsorb;

        emit UpdateAnyoneAbsorb(matrixToken, anyoneAbsorb);
    }

    /**
     * @dev Update address manager fees are sent to.
     *
     * @param matrixToken        Address of MatrixToken
     * @param newFeeRecipient    Address of new fee recipient
     */
    function updateFeeRecipient(IMatrixToken matrixToken, address newFeeRecipient) external onlyManagerAndValidMatrix(matrixToken) {
        require(newFeeRecipient != address(0), "AD0"); // "Passed address must be non-zero"

        _airdropSettings[matrixToken].feeRecipient = newFeeRecipient;

        emit UpdateFeeRecipient(matrixToken, newFeeRecipient);
    }

    /**
     * @dev Update airdrop fee percentage.
     *
     * @param matrixToken    Address of MatrixToken
     * @param newFee         Percentage, in preciseUnits, of new airdrop fee (1e16 = 1%)
     */
    function updateAirdropFee(IMatrixToken matrixToken, uint256 newFee)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndInitializedMatrix(matrixToken)
    {
        require(newFee <= PreciseUnitMath.preciseUnit(), "AD1"); // "Airdrop fee can't exceed 100%"

        // Absorb all outstanding tokens before fee is updated
        _batchAbsorb(matrixToken, _airdropSettings[matrixToken].airdrops);
        _airdropSettings[matrixToken].airdropFee = newFee;

        emit UpdateAirdropFee(matrixToken, newFee);
    }

    /**
     * @dev Initialize module with MatrixToken and set initial airdrop tokens as well as specify whether anyone can call absorb.
     *
     * @param matrixToken       Address of MatrixToken
     * @param airdropSetting    Struct of airdrop setting including accepted airdrops, feeRecipient,
     *                          airdropFee, and indicating if anyone can call an absorb
     */
    function initialize(IMatrixToken matrixToken, AirdropSetting memory airdropSetting)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndPendingMatrix(matrixToken)
    {
        require(airdropSetting.feeRecipient != address(0), "AD2a"); // "Zero fee address passed"
        require(airdropSetting.airdropFee <= PreciseUnitMath.preciseUnit(), "AD2b"); // "Fee must be <= 100%"

        if (airdropSetting.airdrops.length > 0) {
            require(!airdropSetting.airdrops.hasDuplicate(), "AD2c"); // "Duplicate airdrop token passed"
        }

        _airdropSettings[matrixToken] = airdropSetting;

        for (uint256 i = 0; i < airdropSetting.airdrops.length; i++) {
            _isAirdrop[matrixToken][IERC20(airdropSetting.airdrops[i])] = true;
        }

        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     * Token's airdrop settings are deleted. Airdrops are not absorbed.
     * @notice control permission by msg.sender
     */
    function removeModule() external override {
        address[] memory airdrops = _airdropSettings[IMatrixToken(msg.sender)].airdrops;

        for (uint256 i = 0; i < airdrops.length; i++) {
            _isAirdrop[IMatrixToken(msg.sender)][IERC20(airdrops[i])] = false;
        }

        delete _airdropSettings[IMatrixToken(msg.sender)];
    }

    /**
     * @dev Get list of tokens approved to collect airdrops for the MatrixToken.
     *
     * @param matrixToken    Address of MatrixToken
     *
     * @return address[]     Array of tokens approved for airdrops
     */
    function getAirdrops(IMatrixToken matrixToken) external view returns (address[] memory) {
        return _airdropSettings[matrixToken].airdrops;
    }

    // ==================== Public functions ====================

    /**
     * @dev Whether token is approved for airdrops.
     *
     * @param matrixToken    Address of MatrixToken
     *
     * @return bool          Boolean indicating approval for airdrops
     */
    function isAirdropToken(IMatrixToken matrixToken, IERC20 token) public view returns (bool) {
        return _isAirdrop[matrixToken][token];
    }

    // ==================== Internal functions ====================

    /**
     * @dev Check token approved for airdrops then handle airdropped position.
     */
    function _absorb(IMatrixToken matrixToken, IERC20 token) internal {
        require(isAirdropToken(matrixToken, token), "AD3"); // "Must be approved token"

        _handleAirdropPosition(matrixToken, token);
    }

    /**
     * @dev Loop through array of tokens and handle airdropped positions.
     */
    function _batchAbsorb(IMatrixToken matrixToken, address[] memory tokens) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            _absorb(matrixToken, IERC20(tokens[i]));
        }
    }

    /**
     * @dev Calculate amount of tokens airdropped since last absorption, then distribute fees and update position.
     *
     * @param matrixToken    Address of MatrixToken
     * @param token          Address of airdropped token
     */
    function _handleAirdropPosition(IMatrixToken matrixToken, IERC20 token) internal {
        uint256 preFeeTokenBalance = token.balanceOf(address(matrixToken));
        uint256 amountAirdropped = preFeeTokenBalance - matrixToken.getDefaultTrackedBalance(address(token));

        if (amountAirdropped > 0) {
            (uint256 managerTake, uint256 protocolTake, uint256 totalFees) = _handleFees(matrixToken, token, amountAirdropped);
            uint256 newUnit = _getPostAirdropUnit(matrixToken, preFeeTokenBalance, totalFees);
            matrixToken.editDefaultPosition(address(token), newUnit);

            emit AbsorbComponent(matrixToken, token, amountAirdropped, managerTake, protocolTake);
        }
    }

    /**
     * @dev Calculate fee total and distribute between feeRecipient defined on module and the protocol feeRecipient.
     *
     * @param matrixToken         Address of MatrixToken
     * @param component           Address of airdropped component
     * @param amountAirdropped    Amount of tokens airdropped to the MatrixToken
     *
     * @return netManagerTake     Amount of airdropped tokens set aside for manager fees net of protocol fees
     * @return protocolTake       Amount of airdropped tokens set aside for protocol fees (taken from manager fees)
     * @return totalFees          Total fees paid
     */
    function _handleFees(
        IMatrixToken matrixToken,
        IERC20 component,
        uint256 amountAirdropped
    )
        internal
        returns (
            uint256 netManagerTake,
            uint256 protocolTake,
            uint256 totalFees
        )
    {
        uint256 airdropFee = _airdropSettings[matrixToken].airdropFee;

        if (airdropFee != 0) {
            totalFees = amountAirdropped.preciseMul(airdropFee);
            protocolTake = getModuleFee(AIRDROP_MODULE_PROTOCOL_FEE_INDEX, totalFees);
            netManagerTake = totalFees - protocolTake;

            matrixToken.invokeSafeTransfer(address(component), _airdropSettings[matrixToken].feeRecipient, netManagerTake);
            payProtocolFeeFromMatrixToken(matrixToken, address(component), protocolTake);
        }
    }

    /**
     * @dev Retrieve new unit, which is the current balance less fees paid divided by total supply
     */
    function _getPostAirdropUnit(
        IMatrixToken matrixToken,
        uint256 totalComponentBalance,
        uint256 totalFeesPaid
    ) internal view returns (uint256) {
        uint256 totalSupply = matrixToken.totalSupply();

        return PositionUtil.getDefaultPositionUnit(totalSupply, totalComponentBalance - totalFeesPaid);
    }

    function _addAirdrop(IMatrixToken matrixToken, IERC20 airdropToken) internal {
        require(!isAirdropToken(matrixToken, airdropToken), "AD4"); // "Token already added"

        _isAirdrop[matrixToken][airdropToken] = true;
        _airdropSettings[matrixToken].airdrops.push(address(airdropToken));

        emit AddAirdropComponent(matrixToken, airdropToken);
    }

    function _batchAddAirdrop(IMatrixToken matrixToken, IERC20[] memory airdropTokens) internal {
        for (uint256 i = 0; i < airdropTokens.length; i++) {
            _addAirdrop(matrixToken, airdropTokens[i]);
        }
    }

    function _removeAirdrop(IMatrixToken matrixToken, IERC20 airdropToken) internal {
        require(isAirdropToken(matrixToken, airdropToken), "AD5"); // "Token not added"

        _isAirdrop[matrixToken][airdropToken] = false;
        _airdropSettings[matrixToken].airdrops.quickRemoveItem(address(airdropToken));

        emit RemoveAirdropComponent(matrixToken, airdropToken);
    }

    // ==================== Private functions ====================

    function _onlyValidCaller(IMatrixToken matrixToken) private view {
        require(_airdropSettings[matrixToken].anyoneAbsorb || isMatrixManager(matrixToken, msg.sender), "AD6"); // "Must be valid caller"
    }
}
