// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IStreamingFeeModule } from "../../interfaces/IStreamingFeeModule.sol";

/**
 * @title StreamingFeeModule
 *
 * @dev accrues streaming fees for Matrix managers. Streaming fees are denominated
 * as percent per year and realized as Matrix inflation rewarded to the manager.
 */
contract StreamingFeeModule is ModuleBase, IStreamingFeeModule, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using PreciseUnitMath for uint256;
    using PreciseUnitMath for int256;

    // ==================== Constants ====================

    uint256 private constant ONE_YEAR_IN_SECONDS = 365.25 days;
    uint256 private constant PROTOCOL_STREAMING_FEE_INDEX = 0;

    // ==================== Variables ====================

    mapping(IMatrixToken => FeeState) internal _feeStates;

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== External functions ====================

    function getFeeState(IMatrixToken matrixToken) external view returns (FeeState memory) {
        return _feeStates[matrixToken];
    }

    /**
     * @dev MANAGER ONLY. Initialize module with MatrixToken and set the fee state for the MatrixToken.
     ( Passed feeState will have lastStreamingFeeTimestamp over-written.
     *
     * @param matrixToken    Address of MatrixToken
     * @param feeState       FeeState struct defining fee parameters
     */
    function initialize(IMatrixToken matrixToken, FeeState memory feeState)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndPendingMatrix(matrixToken)
    {
        require(feeState.feeRecipient != address(0), "SF0a"); // "Fee Recipient must be non-zero address."
        require(feeState.maxStreamingFeePercentage < PreciseUnitMath.preciseUnit(), "SF0b"); // "Max fee must be < 100%"
        require(feeState.streamingFeePercentage <= feeState.maxStreamingFeePercentage, "SF0c"); // "Fee must be <= max"

        feeState.lastStreamingFeeTimestamp = block.timestamp;
        _feeStates[matrixToken] = feeState;
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken. Manager's feeState is deleted.
     * Fees are not accrued in case reason for removing module is related to fee accrual.
     * @notice control permission by msg.sender
     */
    function removeModule() external override {
        delete _feeStates[IMatrixToken(msg.sender)];
    }

    /**
     * @dev Update new streaming fee. Fees accrue at current rate then new rate is set.
     * Fees are accrued to prevent the manager from unfairly accruing a larger percentage.
     *
     * @param matrixToken    Address of MatrixToken
     * @param newFee         New streaming fee 18 decimal precision
     */
    function updateStreamingFee(IMatrixToken matrixToken, uint256 newFee)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndInitializedMatrix(matrixToken)
    {
        require(newFee <= _maxStreamingFeePercentage(matrixToken), "SF1"); // "Fee must be less than max"
        actualizeFee(matrixToken);
        _feeStates[matrixToken].streamingFeePercentage = newFee;

        emit UpdateStreamingFee(address(matrixToken), newFee);
    }

    /**
     * @dev Update new fee recipient.
     *
     * @param matrixToken        Address of MatrixToken
     * @param newFeeRecipient    New fee recipient
     */
    function updateFeeRecipient(IMatrixToken matrixToken, address newFeeRecipient)
        external
        onlyMatrixManager(matrixToken, msg.sender)
        onlyValidAndInitializedMatrix(matrixToken)
    {
        require(newFeeRecipient != address(0), "SF2"); // "Fee Recipient must be non-zero address")

        _feeStates[matrixToken].feeRecipient = newFeeRecipient;

        emit UpdateFeeRecipient(address(matrixToken), newFeeRecipient);
    }

    /**
     * @dev Calculates total inflation percentage in order to accrue fees to manager.
     *
     * @param matrixToken    Address of MatrixToken
     *
     * @return uint256       Percent inflation of supply
     */
    function getFee(IMatrixToken matrixToken) external view returns (uint256) {
        return _calculateStreamingFee(matrixToken);
    }

    // ==================== Public functions ====================

    /**
     * @dev Calculates total inflation percentage then mints new MatrixToken to the fee recipient. Position units are
     * then adjusted down (in magnitude) in order to ensure full collateralization. Callable by anyone.
     *
     * @param matrixToken    Address of MatrixToken
     */
    function actualizeFee(IMatrixToken matrixToken) public nonReentrant onlyValidAndInitializedMatrix(matrixToken) {
        uint256 managerFee;
        uint256 protocolFee;

        if (_streamingFeePercentage(matrixToken) > 0) {
            uint256 inflationFeePercentage = _calculateStreamingFee(matrixToken);

            // Calculate incentiveFee inflation
            uint256 feeQuantity = _calculateStreamingFeeInflation(matrixToken, inflationFeePercentage);

            // Mint new MatrixToken to manager and protocol
            (managerFee, protocolFee) = _mintManagerAndProtocolFee(matrixToken, feeQuantity);

            _editPositionMultiplier(matrixToken, inflationFeePercentage);
        }

        _feeStates[matrixToken].lastStreamingFeeTimestamp = block.timestamp;

        emit ActualizeFee(address(matrixToken), managerFee, protocolFee);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Calculates streaming fee by multiplying streamingFeePercentage by the elapsed amount of time
     * since the last fee was collected divided by one year in seconds, since the fee is a yearly fee.
     *
     * @param matrixToken    Address of Matrix to have feeState updated
     *
     * @return uint256       Streaming fee denominated in percentage of totalSupply
     */
    function _calculateStreamingFee(IMatrixToken matrixToken) internal view returns (uint256) {
        uint256 timeSinceLastFee = block.timestamp - _lastStreamingFeeTimestamp(matrixToken);

        // Streaming fee is streaming fee times years since last fee
        return (timeSinceLastFee * _streamingFeePercentage(matrixToken)) / ONE_YEAR_IN_SECONDS;
    }

    /**
     * @dev Returns the new incentive fee denominated in the number of MatrixToken to mint. The calculation for the fee involves
     * implying mint quantity so that the feeRecipient owns the fee percentage of the entire supply of the Matrix.
     *
     * The formula to solve for fee is:
     * (feeQuantity / feeQuantity) + totalSupply = fee / scaleFactor
     *
     * The simplified formula utilized below is:
     * feeQuantity = fee * totalSupply / (scaleFactor - fee)
     *
     * @param matrixToken      MatrixToken instance
     * @param feePercentage    Fee levied to feeRecipient
     *
     * @return uint256         New RebalancingSet issue quantity
     */
    function _calculateStreamingFeeInflation(IMatrixToken matrixToken, uint256 feePercentage) internal view returns (uint256) {
        uint256 totalSupply = matrixToken.totalSupply();
        uint256 a = feePercentage * totalSupply; // fee * totalSupply
        uint256 b = PreciseUnitMath.preciseUnit() - feePercentage; // ScaleFactor (10e18) - fee
        return a / b;
    }

    /**
     * @dev Mints MatrixToken to both the manager and the protocol.
     * Protocol takes a percentage fee of the total amount of MatrixToken minted to manager.
     *
     * @param matrixToken    MatrixToken instance
     * @param feeQuantity    Amount of MatrixToken to be minted as fees
     *
     * @return uint256       Amount of MatrixToken accrued to manager as fee
     * @return uint256       Amount of MatrixToken accrued to protocol as fee
     */
    function _mintManagerAndProtocolFee(IMatrixToken matrixToken, uint256 feeQuantity) internal returns (uint256, uint256) {
        address protocolFeeRecipient = _controller.getFeeRecipient();
        uint256 protocolFee = _controller.getModuleFee(address(this), PROTOCOL_STREAMING_FEE_INDEX);

        uint256 protocolFeeAmount = feeQuantity.preciseMul(protocolFee);
        uint256 managerFeeAmount = feeQuantity - protocolFeeAmount;

        matrixToken.mint(_feeRecipient(matrixToken), managerFeeAmount);

        if (protocolFeeAmount > 0) {
            matrixToken.mint(protocolFeeRecipient, protocolFeeAmount);
        }

        return (managerFeeAmount, protocolFeeAmount);
    }

    /**
     * @dev Calculates new position multiplier according to following formula:
     * newMultiplier = oldMultiplier * (1 - inflationFee)
     * This reduces position sizes to offset increase in supply due to fee collection.
     *
     * @param matrixToken     MatrixToken instance
     * @param inflationFee    Fee inflation rate
     */
    function _editPositionMultiplier(IMatrixToken matrixToken, uint256 inflationFee) internal {
        int256 currentMultipler = matrixToken.getPositionMultiplier();
        int256 newMultiplier = currentMultipler.preciseMul((PreciseUnitMath.preciseUnit() - inflationFee).toInt256());

        matrixToken.editPositionMultiplier(newMultiplier);
    }

    function _feeRecipient(IMatrixToken matrixToken) internal view returns (address) {
        return _feeStates[matrixToken].feeRecipient;
    }

    function _lastStreamingFeeTimestamp(IMatrixToken matrixToken) internal view returns (uint256) {
        return _feeStates[matrixToken].lastStreamingFeeTimestamp;
    }

    function _maxStreamingFeePercentage(IMatrixToken matrixToken) internal view returns (uint256) {
        return _feeStates[matrixToken].maxStreamingFeePercentage;
    }

    function _streamingFeePercentage(IMatrixToken matrixToken) internal view returns (uint256) {
        return _feeStates[matrixToken].streamingFeePercentage;
    }
}
