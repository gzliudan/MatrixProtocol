// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";
import { PositionUtil } from "../lib/PositionUtil.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IStakingAdapter } from "../../interfaces/IStakingAdapter.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";

/**
 * @title StakingModule
 *
 * @dev This module enables managers to stake tokens in external protocols in order to take advantage of token distributions.
 * Managers are in charge of opening and closing staking positions. When issuing new MatrixToken the IssuanceModule can call
 * the StakingModule in order to facilitate replicating existing staking positions.
 *
 * The StakingModule works in conjunction with StakingAdapters, in which the claimAdapterID / integrationNames are stored
 * on the integration registry. StakingAdapters for the StakingModule are more functional in nature as the same staking
 * contracts are being used across multiple protocols.
 *
 * An example of staking actions include staking yCRV tokens in CRV Liquidity Gauge
 */
contract StakingModule is ModuleBase, IModuleIssuanceHook {
    using SafeCast for int256;
    using SafeCast for uint256;
    using AddressArrayUtil for address[];
    using PositionUtil for IMatrixToken;

    // ==================== Structs ====================

    struct StakingPosition {
        uint256 componentPositionUnits; // The amount of tokens, per MatrixToken, being staked on associated staking contract
        bytes32 adapterHash; // Hash of adapter name
    }

    struct ComponentPositions {
        address[] stakingContracts; // List of staking contracts component is being staked on
        mapping(address => StakingPosition) positions; // Details of each stakingContract's position
    }

    // ==================== Variables ====================

    // IMatrixToken => component => ComponentPositions
    // holding all the external staking positions for the component
    mapping(IMatrixToken => mapping(IERC20 => ComponentPositions)) internal _stakingPositions;

    // ==================== Events ====================

    event StakeComponent(
        IMatrixToken indexed matrixToken,
        IERC20 indexed component,
        address indexed stakingContract,
        uint256 componentPositionUnits,
        IStakingAdapter adapter
    );

    event UnstakeComponent(
        IMatrixToken indexed matrixToken,
        IERC20 indexed component,
        address indexed stakingContract,
        uint256 componentPositionUnits,
        IStakingAdapter adapter
    );

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== External functions ====================

    function getStakingContracts(IMatrixToken matrixToken, IERC20 component) external view returns (address[] memory) {
        return _stakingPositions[matrixToken][component].stakingContracts;
    }

    function getStakingPosition(
        IMatrixToken matrixToken,
        IERC20 component,
        address stakeContract
    ) external view returns (StakingPosition memory) {
        return _stakingPositions[matrixToken][component].positions[stakeContract];
    }

    /**
     * @dev MANAGER ONLY: Stake component in external staking contract. Update state on StakingModule and MatrixToken to reflect
     * new position. Manager states the contract they are wishing to stake the passed component in as well as how many
     * position units they wish to stake. Manager must also identify the adapter they wish to use.
     *
     * @param matrixToken               Address of MatrixToken contract
     * @param stakeContract             Address of staking contract
     * @param component                 Address of token being staked
     * @param adapterName               Name of adapter used to interact with staking contract
     * @param componentPositionUnits    Quantity of token to stake in position units
     */
    function stake(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        string memory adapterName,
        uint256 componentPositionUnits
    ) external onlyManagerAndValidMatrix(matrixToken) {
        require(matrixToken.hasSufficientDefaultUnits(address(component), componentPositionUnits), "SM0"); // "Not enough component to stake"

        IStakingAdapter adapter = IStakingAdapter(getAndValidateAdapter(adapterName));
        _stake(matrixToken, stakeContract, component, adapter, componentPositionUnits, matrixToken.totalSupply());
        _updateStakeState(matrixToken, stakeContract, component, adapterName, componentPositionUnits);

        emit StakeComponent(matrixToken, component, stakeContract, componentPositionUnits, adapter);
    }

    /**
     * @dev MANAGER ONLY: Unstake component from external staking contract.
     * Update state on StakingModule and MatrixToken to reflect new position.
     *
     * @param matrixToken               Address of MatrixToken contract
     * @param stakeContract             Address of staking contract
     * @param component                 Address of token being staked
     * @param adapterName               Name of adapter used to interact with staking contract
     * @param componentPositionUnits    Quantity of token to unstake in position units
     */
    function unstake(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        string memory adapterName,
        uint256 componentPositionUnits
    ) external onlyManagerAndValidMatrix(matrixToken) {
        require(getStakingPositionUnit(matrixToken, component, stakeContract) >= componentPositionUnits, "SM1"); // "Not enough component tokens staked"

        IStakingAdapter adapter = IStakingAdapter(getAndValidateAdapter(adapterName));
        _unstake(matrixToken, stakeContract, component, adapter, componentPositionUnits, matrixToken.totalSupply());
        _updateUnstakeState(matrixToken, stakeContract, component, componentPositionUnits);

        emit UnstakeComponent(matrixToken, component, stakeContract, componentPositionUnits, adapter);
    }

    /**
     * @dev MODULE ONLY: On issuance, replicates all staking positions for a given component by staking the component transferred into
     * the MatrixToken by an issuer. The amount staked should only be the notional amount required to replicate a matrixTokenQuantity
     * amount of a position. No updates to positions should take place.
     *
     * @param matrixToken            Address of MatrixToken contract
     * @param component              Address of token being staked
     * @param matrixTokenQuantity    Quantity of MatrixToken being issued
     */
    function componentIssueHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external override onlyModule(matrixToken) {
        ComponentPositions storage componentPositions = _stakingPositions[matrixToken][component];
        address[] storage stakingContracts = componentPositions.stakingContracts;

        for (uint256 i = 0; i < stakingContracts.length; i++) {
            // NOTE: We assume here that the calling module has transferred component tokens to the MatrixToken from the issuer
            StakingPosition storage stakingPosition = componentPositions.positions[stakingContracts[i]];

            _stake(
                matrixToken,
                stakingContracts[i],
                component,
                IStakingAdapter(getAndValidateAdapterWithHash(stakingPosition.adapterHash)),
                stakingPosition.componentPositionUnits,
                matrixTokenQuantity
            );
        }
    }

    /**
     * @dev MODULE ONLY: On redemption, unwind all staking positions for a given asset by unstaking the given component. The amount
     * unstaked should only be the notional amount required to unwind a matrixTokenQuantity amount of a position. No updates to
     * positions should take place.
     *
     * @param matrixToken            Address of MatrixToken contract
     * @param component              Address of token being staked
     * @param matrixTokenQuantity    Quantity of MatrixToken being issued
     */
    function componentRedeemHook(
        IMatrixToken matrixToken,
        uint256 matrixTokenQuantity,
        IERC20 component,
        bool /* isEquity */
    ) external override onlyModule(matrixToken) {
        ComponentPositions storage componentPositions = _stakingPositions[matrixToken][component];
        address[] storage stakingContracts = componentPositions.stakingContracts;

        for (uint256 i = 0; i < stakingContracts.length; i++) {
            StakingPosition storage stakingPosition = componentPositions.positions[stakingContracts[i]];

            _unstake(
                matrixToken,
                stakingContracts[i],
                component,
                IStakingAdapter(getAndValidateAdapterWithHash(stakingPosition.adapterHash)),
                stakingPosition.componentPositionUnits,
                matrixTokenQuantity
            );
        }
    }

    function moduleIssueHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external override {}

    function moduleRedeemHook(IMatrixToken matrixToken, uint256 matrixTokenQuantity) external override {}

    /**
     * @dev Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     */
    function initialize(IMatrixToken matrixToken) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken. If an outstanding staking position
     * remains using this module then it cannot be removed. Outstanding staking must be closed out first before removal.
     * @notice control permission by msg.sender
     */
    function removeModule() external view override {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);
        // TODO: verify msg.sender is IMatrixToken here
        address[] memory components = matrixToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            require(_stakingPositions[matrixToken][IERC20(components[i])].stakingContracts.length == 0, "SM2"); // "Open positions must be closed"
        }
    }

    // ==================== Public functions ====================

    function hasStakingPosition(
        IMatrixToken matrixToken,
        IERC20 component,
        address stakeContract
    ) public view returns (bool) {
        return _stakingPositions[matrixToken][component].stakingContracts.contain(stakeContract);
    }

    function getStakingPositionUnit(
        IMatrixToken matrixToken,
        IERC20 component,
        address stakeContract
    ) public view returns (uint256) {
        return _stakingPositions[matrixToken][component].positions[stakeContract].componentPositionUnits;
    }

    // ==================== Internal functions ====================

    /**
     * @dev Stake component in external staking contract.
     *
     * @param matrixToken                 Address of MatrixToken contract
     * @param stakeContract               Address of staking contract
     * @param component                   Address of token being staked
     * @param adapter                     Address of adapter used to interact with staking contract
     * @param componentPositionUnits      Quantity of token to stake in position units
     * @param matrixTokenStakeQuantity    Quantity of MatrixToken to stake
     */
    function _stake(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        IStakingAdapter adapter,
        uint256 componentPositionUnits,
        uint256 matrixTokenStakeQuantity
    ) internal {
        uint256 notionalStakeQuantity = PositionUtil.getDefaultTotalNotional(matrixTokenStakeQuantity, componentPositionUnits);
        address spender = adapter.getSpenderAddress(stakeContract);
        matrixToken.invokeSafeIncreaseAllowance(address(component), spender, notionalStakeQuantity);
        (address target, uint256 callValue, bytes memory methodData) = adapter.getStakeCallData(stakeContract, notionalStakeQuantity);
        matrixToken.invoke(target, callValue, methodData);
    }

    /**
     * Unstake position from external staking contract and validates expected components were received.
     *
     * @param matrixToken               Address of MatrixToken contract
     * @param stakeContract             Address of staking contract
     * @param component                 Address of token being unstaked
     * @param adapter                   Address of adapter used to interact with staking contract
     * @param componentPositionUnits    Quantity of token to unstake in position units
     */
    function _unstake(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        IStakingAdapter adapter,
        uint256 componentPositionUnits,
        uint256 matrixTokenUnstakeQuantity
    ) internal {
        uint256 preActionBalance = component.balanceOf(address(matrixToken));
        uint256 notionalUnstakeQuantity = PositionUtil.getDefaultTotalNotional(matrixTokenUnstakeQuantity, componentPositionUnits);
        (address target, uint256 callValue, bytes memory methodData) = adapter.getUnstakeCallData(stakeContract, notionalUnstakeQuantity);
        matrixToken.invoke(target, callValue, methodData);
        uint256 postActionBalance = component.balanceOf(address(matrixToken));

        require(preActionBalance + notionalUnstakeQuantity <= postActionBalance, "SM3"); // "Not enough tokens returned from stake contract"
    }

    /**
     * @dev Update positions on MatrixToken and tracking on StakingModule after staking is complete. Includes the following updates:
     *  - If adding to position then add positionUnits to existing position amount on StakingModule
     *  - If opening new staking position add stakeContract to stakingContracts list and create position entry in position mapping(on StakingModule)
     *  - Subtract from Default position of component on MatrixToken
     *  - Add to external position of component on MatrixToken referencing this module
     *
     * @param matrixToken               Address of MatrixToken contract
     * @param stakeContract             Address of staking contract
     * @param component                 Address of token being unstaked
     * @param adapterName               Address of adapter used to interact with staking contract
     * @param componentPositionUnits    Quantity of token to stake in position units
     */
    function _updateStakeState(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        string memory adapterName,
        uint256 componentPositionUnits
    ) internal {
        if (hasStakingPosition(matrixToken, component, stakeContract)) {
            _stakingPositions[matrixToken][component].positions[stakeContract].componentPositionUnits =
                componentPositionUnits +
                getStakingPositionUnit(matrixToken, component, stakeContract);
        } else {
            _stakingPositions[matrixToken][component].stakingContracts.push(stakeContract);
            _stakingPositions[matrixToken][component].positions[stakeContract] = StakingPosition({
                componentPositionUnits: componentPositionUnits,
                adapterHash: getNameHash(adapterName)
            });
        }

        uint256 newDefaultTokenUnit = matrixToken.getDefaultPositionRealUnit(address(component)).toUint256() - componentPositionUnits;
        matrixToken.editDefaultPosition(address(component), newDefaultTokenUnit);

        int256 newExternalTokenUnit = matrixToken.getExternalPositionRealUnit(address(component), address(this)) + componentPositionUnits.toInt256();
        matrixToken.editExternalPosition(address(component), address(this), newExternalTokenUnit, "");
    }

    /**
     * @dev Update positions on MatrixToken and tracking on StakingModule after unstaking is complete. Includes the following updates:
     *  - If paring down position then subtract positionUnits from existing position amount on StakingModule
     *  - If closing staking position remove stakeContract from stakingContracts list and delete position entry in position mapping(on StakingModule)
     *  - Add to Default position of component on MatrixToken
     *  - Subtract from external position of component on MatrixToken referencing this module
     *
     * @param matrixToken               Address of MatrixToken contract
     * @param stakeContract             Address of staking contract
     * @param component                 Address of token being unstaked
     * @param componentPositionUnits    Quantity of token to stake in position units
     */
    function _updateUnstakeState(
        IMatrixToken matrixToken,
        address stakeContract,
        IERC20 component,
        uint256 componentPositionUnits
    ) internal {
        uint256 remainingPositionUnits = getStakingPositionUnit(matrixToken, component, stakeContract) - componentPositionUnits;

        if (remainingPositionUnits > 0) {
            _stakingPositions[matrixToken][component].positions[stakeContract].componentPositionUnits = remainingPositionUnits;
        } else {
            _stakingPositions[matrixToken][component].stakingContracts.quickRemoveItem(stakeContract);
            delete _stakingPositions[matrixToken][component].positions[stakeContract];
        }

        uint256 newTokenUnit = matrixToken.getDefaultPositionRealUnit(address(component)).toUint256() + componentPositionUnits;
        matrixToken.editDefaultPosition(address(component), newTokenUnit);

        int256 newExternalTokenUnit = matrixToken.getExternalPositionRealUnit(address(component), address(this)) - componentPositionUnits.toInt256();
        matrixToken.editExternalPosition(address(component), address(this), newExternalTokenUnit, "");
    }
}
