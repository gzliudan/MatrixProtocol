// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IGaugeController } from "../../../interfaces/external/curve/IGaugeController.sol";

/**
 * @title CurveStakingAdapter
 *
 * @dev Staking adapter for Curve that returns data to stake/unstake tokens
 */
contract CurveStakingAdapter {
    // ==================== Variables ====================

    IGaugeController internal immutable _gaugeController;

    // ==================== Constructor function ====================

    constructor(IGaugeController gaugeController) {
        _gaugeController = gaugeController;
    }

    // ==================== External functions ====================

    function getGaugeController() external view returns (address) {
        return address(_gaugeController);
    }

    /**
     * Generates the calldata to stake lp tokens in the staking contract
     *
     * @param stakingContract    Address of the gauge staking contract
     * @param notionalAmount     Quantity of token to stake
     *
     * @return target            Target address
     * @return value             Call value
     * @return callData          Stake tokens calldata
     */
    function getStakeCallData(address stakingContract, uint256 notionalAmount)
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        require(_isValidStakingContract(stakingContract), "CSA0"); // "Invalid staking contract"

        value = 0;
        target = stakingContract;
        callData = abi.encodeWithSignature("deposit(uint256)", notionalAmount);
    }

    /**
     * Generates the calldata to unstake lp tokens from the staking contract
     *
     * @param stakingContract    Address of the gauge staking contract
     * @param notionalAmount     Quantity of token to stake
     *
     * @return target            Target address
     * @return value             Call value
     * @return callData          Unstake tokens calldata
     */
    function getUnstakeCallData(address stakingContract, uint256 notionalAmount)
        external
        view
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        require(_isValidStakingContract(stakingContract), "CSA1"); // "Invalid staking contract"

        value = 0;
        target = stakingContract;
        callData = abi.encodeWithSignature("withdraw(uint256)", notionalAmount);
    }

    /**
     * Returns the address to approve component for staking tokens.
     *
     * @param stakingContract    Address of the gauge staking contract
     *
     * @return address           Address of the contract to approve tokens transfers to
     */
    function getSpenderAddress(address stakingContract) external pure returns (address) {
        return stakingContract;
    }

    // ==================== Internal functions ====================

    /**
     * Validates that the staking contract is registered in the gauge controller
     *
     * @param stakingContract    Address of the gauge staking contract
     *
     * @return bool              Whether or not the staking contract is valid
     */
    function _isValidStakingContract(address stakingContract) internal view returns (bool) {
        // If the gauge address is not defined in the _gaugeController, gauge_types will revert, otherwise returns the value.
        // Here we catch the revert and return false to revert with a proper error message
        try _gaugeController.gauge_types(stakingContract) {
            return true;
        } catch {
            return false;
        }
    }
}
