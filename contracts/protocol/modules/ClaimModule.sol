// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { AddressArrayUtil } from "../../lib/AddressArrayUtil.sol";

import { ModuleBase } from "../lib/ModuleBase.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IClaimAdapter } from "../../interfaces/IClaimAdapter.sol";

/**
 * @title ClaimModule
 *
 * @dev Module that enables managers to claim tokens from external protocols given to the MatrixToken as part of
 * participating in incentivized activities of other protocols. The ClaimModule works in conjunction with ClaimAdapters,
 * in which the claimAdapterID / integrationNames are stored on the integration registry.
 *
 * Design:
 * The ecosystem is coalescing around a few standards of how reward programs are created, using forks of popular
 * contracts such as Synthetix's Mintr. Thus, the Claim architecture reflects a more functional vs external-protocol
 * approach where an adapter with common functionality can be used across protocols.
 *
 * Definitions:
 * Reward Pool: A reward pool is a contract associated with an external protocol's reward. Examples of reward pools
 *   include the Curve sUSDV2 Gauge or the Synthetix iBTC StakingReward contract.
 * Adapter: An adapter contains the logic and context for how a reward pool should be claimed - returning the requisite
 *   function signature. Examples of adapters include StakingRewardAdapter (for getting rewards from Synthetix-like
 *   reward contracts) and CurveClaimAdapter (for calling Curve Minter contract's mint function)
 * ClaimSettings: A reward pool can be associated with multiple awards. For example, a Curve liquidity gauge can be
 *   associated with the CURVE_CLAIM adapter to claim CRV and CURVE_DIRECT adapter to claim BPT.
 */
contract ClaimModule is ModuleBase {
    using AddressArrayUtil for address[];

    // ==================== Variables ====================

    // Indicates if any address can call claim or just the manager of the MatrixToken
    mapping(IMatrixToken => bool) public _anyoneClaim;

    // IMatrixToken => array of rewardPool addresses
    mapping(IMatrixToken => address[]) public _rewardPools;

    // IMatrixToken => rewards pool address => isAdded boolean. Used to check if a reward pool has been added in O(1) time
    mapping(IMatrixToken => mapping(address => bool)) public _rewardPoolStatus;

    // IMatrixToken => rewardPool => array of adapters
    mapping(IMatrixToken => mapping(address => address[])) public _claimSettings;

    // IMatrixToken => rewards pool address => claim adapters => isAdded boolean. Used to check if an adapter has been added in O(1) time
    mapping(IMatrixToken => mapping(address => mapping(address => bool))) public claimSettingsStatus;

    // ==================== Events ====================

    event ClaimReward(IMatrixToken indexed matrixToken, address indexed rewardPool, IClaimAdapter indexed adapter, uint256 amount);
    event UpdateAnyoneClaim(IMatrixToken indexed matrixToken, bool anyoneClaim);

    // ==================== Constructor function ====================

    constructor(IController controller, string memory name) ModuleBase(controller, name) {}

    // ==================== Modifier functions ====================

    modifier onlyValidCaller(IMatrixToken matrixToken) {
        _onlyValidCaller(matrixToken);
        _;
    }

    // ==================== External functions ====================

    /**
     * @dev Claim the rewards available on the rewardPool for the specified claim integration.
     * Callable only by manager unless manager has set _anyoneClaim to true.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function claim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) external onlyValidAndInitializedMatrix(matrixToken) onlyValidCaller(matrixToken) {
        _claim(matrixToken, rewardPool, integrationName);
    }

    /**
     * @dev Claims rewards on all the passed rewardPool/claim integration pairs. Callable only by manager unless manager has set _anyoneClaim to true.
     *
     * @param matrixToken         Address of MatrixToken
     * @param rewardPools         Addresses of rewardPools that identifies the contract governing claims. Maps to same index integrationNames
     * @param integrationNames    Human-readable names matching adapter used to collect claim on pool. Maps to same index in rewardPools
     */
    function batchClaim(
        IMatrixToken matrixToken,
        address[] calldata rewardPools,
        string[] calldata integrationNames
    ) external onlyValidAndInitializedMatrix(matrixToken) onlyValidCaller(matrixToken) {
        uint256 poolArrayLength = _validateBatchArrays(rewardPools, integrationNames);

        for (uint256 i = 0; i < poolArrayLength; i++) {
            _claim(matrixToken, rewardPools[i], integrationNames[i]);
        }
    }

    /**
     * @dev MANAGER ONLY. Update whether manager allows other addresses to call claim.
     *
     * @param matrixToken    Address of MatrixToken
     */
    function updateAnyoneClaim(IMatrixToken matrixToken, bool anyoneClaim) external onlyManagerAndValidMatrix(matrixToken) {
        _anyoneClaim[matrixToken] = anyoneClaim;
        emit UpdateAnyoneClaim(matrixToken, anyoneClaim);
    }

    /**
     * @dev MANAGER ONLY. Adds a new claim integration for an existent rewardPool. If rewardPool doesn't have existing
     * claims then rewardPool is added to rewardPoolLiost. The claim integration is associated to an adapter that
     * provides the functionality to claim the rewards for a specific token.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function addClaim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) external onlyManagerAndValidMatrix(matrixToken) {
        _addClaim(matrixToken, rewardPool, integrationName);
    }

    /**
     * @dev MANAGER ONLY. Adds a new rewardPool to the list to perform claims for the MatrixToken indicating the list of
     * claim integrations. Each claim integration is associated to an adapter that provides the functionality to claim
     * the rewards for a specific token.
     *
     * @param matrixToken         Address of MatrixToken
     * @param rewardPools         Addresses of rewardPools that identifies the contract governing claims. Maps to same index integrationNames
     * @param integrationNames    Human-readable names matching adapter used to collect claim on pool. Maps to same index in rewardPools
     */
    function batchAddClaim(
        IMatrixToken matrixToken,
        address[] calldata rewardPools,
        string[] calldata integrationNames
    ) external onlyManagerAndValidMatrix(matrixToken) {
        _batchAddClaim(matrixToken, rewardPools, integrationNames);
    }

    /**
     * @dev MANAGER ONLY. Removes a claim integration from an existent rewardPool.
     * If no claim remains for reward pool then reward pool is removed from _rewardPools.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function removeClaim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) external onlyManagerAndValidMatrix(matrixToken) {
        _removeClaim(matrixToken, rewardPool, integrationName);
    }

    /**
     * @dev MANAGER ONLY. Batch removes claims from MatrixToken's settings.
     *
     * @param matrixToken         Address of MatrixToken
     * @param rewardPools         Addresses of rewardPools that identifies the contract governing claims. Maps to same index integrationNames
     * @param integrationNames    Human-readable names matching adapter used to collect claim on pool. Maps to same index in rewardPools
     */
    function batchRemoveClaim(
        IMatrixToken matrixToken,
        address[] calldata rewardPools,
        string[] calldata integrationNames
    ) external onlyManagerAndValidMatrix(matrixToken) {
        uint256 poolArrayLength = _validateBatchArrays(rewardPools, integrationNames);
        for (uint256 i = 0; i < poolArrayLength; i++) {
            _removeClaim(matrixToken, rewardPools[i], integrationNames[i]);
        }
    }

    /**
     * @dev MANAGER ONLY. Initializes this module to the MatrixToken.
     *
     * @param matrixToken         Instance of the MatrixToken to issue
     * @param anyoneClaim         Boolean indicating if anyone can claim or just manager
     * @param rewardPools         Addresses of rewardPools that identifies the contract governing claims. Maps to same index integrationNames
     * @param integrationNames    Human-readable names matching adapter used to collect claim on pool. Maps to same index in rewardPools
     */
    function initialize(
        IMatrixToken matrixToken,
        bool anyoneClaim,
        address[] calldata rewardPools,
        string[] calldata integrationNames
    ) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        _batchAddClaim(matrixToken, rewardPools, integrationNames);
        _anyoneClaim[matrixToken] = anyoneClaim;
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     */
    function removeModule() external override {
        IMatrixToken matrixToken = IMatrixToken(msg.sender);
        delete _anyoneClaim[matrixToken];

        // explicitly delete all elements for gas refund
        address[] storage matrixTokenPoolList = _rewardPools[matrixToken];
        for (uint256 i = 0; i < matrixTokenPoolList.length; i++) {
            address matrixTokenPool = matrixTokenPoolList[i];
            address[] storage adapterList = _claimSettings[matrixToken][matrixTokenPool];

            for (uint256 j = 0; j < adapterList.length; j++) {
                address toRemove = adapterList[j];
                claimSettingsStatus[matrixToken][matrixTokenPool][toRemove] = false;
                delete adapterList[j];
            }

            delete _claimSettings[matrixToken][matrixTokenPool];
        }

        for (uint256 i = 0; i < _rewardPools[matrixToken].length; i++) {
            address toRemove = _rewardPools[matrixToken][i];
            _rewardPoolStatus[matrixToken][toRemove] = false;
            delete _rewardPools[matrixToken][i];
        }

        delete _rewardPools[matrixToken];
    }

    /**
     * @dev Get list of rewardPools to perform claims for the MatrixToken.
     *
     * @param matrixToken    Address of MatrixToken
     *
     * @return address[]     Array of rewardPool addresses to claim rewards for the MatrixToken
     */
    function getRewardPools(IMatrixToken matrixToken) external view returns (address[] memory) {
        return _rewardPools[matrixToken];
    }

    /**
     * @dev Get list of claim integration of the rewardPool for the MatrixToken.
     *
     * @param matrixToken    Address of MatrixToken
     * @param rewardPool     Address of rewardPool
     * @return               Array of adapter addresses associated to the rewardPool for the MatrixToken
     */
    function getRewardPoolClaims(IMatrixToken matrixToken, address rewardPool) external view returns (address[] memory) {
        return _claimSettings[matrixToken][rewardPool];
    }

    /**
     * @dev Get boolean indicating if the adapter address of the claim integration is associated to the rewardPool.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of rewardPool
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     *
     * @return bool              Boolean indicating if the claim integration is associated to the rewardPool.
     */
    function isRewardPoolClaim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) external view returns (bool) {
        address adapter = getAndValidateAdapter(integrationName);
        return claimSettingsStatus[matrixToken][rewardPool][adapter];
    }

    /**
     * @dev Get the rewards available to be claimed by the claim integration on the rewardPool.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     *
     * @return uint256           Amount of units available to be claimed
     */
    function getRewards(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) external view returns (uint256) {
        IClaimAdapter adapter = _getAndValidateIntegrationAdapter(matrixToken, rewardPool, integrationName);
        return adapter.getRewardsAmount(matrixToken, rewardPool);
    }

    // ==================== Public functions ====================

    /**
     * @dev Get boolean indicating if the rewardPool is in the list to perform claims for the MatrixToken.
     *
     * @param matrixToken    Address of MatrixToken
     * @param rewardPool     Address of rewardPool
     *
     * @return bool          Boolean indicating if the rewardPool is in the list for claims.
     */
    function isRewardPool(IMatrixToken matrixToken, address rewardPool) public view returns (bool) {
        return _rewardPoolStatus[matrixToken][rewardPool];
    }

    // ==================== Internal functions ====================

    /**
     * @dev Claim the rewards, if available, on the rewardPool using the specified adapter. Interact with the adapter to get
     * the rewards available, the calldata for the MatrixToken to invoke the claim and the token associated to the claim.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    Human readable name of claim integration
     */
    function _claim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) internal {
        require(isRewardPool(matrixToken, rewardPool), "CM0");

        IClaimAdapter adapter = _getAndValidateIntegrationAdapter(matrixToken, rewardPool, integrationName);
        IERC20 rewardsToken = IERC20(adapter.getTokenAddress(rewardPool));
        uint256 initRewardsBalance = rewardsToken.balanceOf(address(matrixToken));
        (address callTarget, uint256 callValue, bytes memory callByteData) = adapter.getClaimCallData(matrixToken, rewardPool);
        matrixToken.invoke(callTarget, callValue, callByteData);
        uint256 finalRewardsBalance = rewardsToken.balanceOf(address(matrixToken));

        emit ClaimReward(matrixToken, rewardPool, adapter, finalRewardsBalance - initRewardsBalance);
    }

    /**
     * @dev Gets the adapter and validate it is associated to the list of claim integration of a rewardPool.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardsPool        Sddress of rewards pool
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function _getAndValidateIntegrationAdapter(
        IMatrixToken matrixToken,
        address rewardsPool,
        string calldata integrationName
    ) internal view returns (IClaimAdapter) {
        address adapter = getAndValidateAdapter(integrationName);
        require(claimSettingsStatus[matrixToken][rewardsPool][adapter], "CM1");

        return IClaimAdapter(adapter);
    }

    /**
     * @dev Validates and store the adapter address used to claim rewards for the passed rewardPool. If after adding
     * adapter to pool length of adapters is 1 then add to _rewardPools as well.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function _addClaim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) internal {
        address adapter = getAndValidateAdapter(integrationName);
        address[] storage _rewardPoolClaimSettings = _claimSettings[matrixToken][rewardPool];

        require(!claimSettingsStatus[matrixToken][rewardPool][adapter], "CM2");
        _rewardPoolClaimSettings.push(adapter);
        claimSettingsStatus[matrixToken][rewardPool][adapter] = true;

        if (!_rewardPoolStatus[matrixToken][rewardPool]) {
            _rewardPools[matrixToken].push(rewardPool);
            _rewardPoolStatus[matrixToken][rewardPool] = true;
        }
    }

    /**
     * @dev Internal version. Adds a new rewardPool to the list to perform claims for the MatrixToken indicating the list of claim
     * integrations. Each claim integration is associated to an adapter that provides the functionality to claim the rewards
     * for a specific token.
     *
     * @param matrixToken         Address of MatrixToken
     * @param rewardPools         Addresses of rewardPools that identifies the contract governing claims. Maps to same index integrationNames
     * @param integrationNames    Human-readable names matching adapter used to collect claim on pool. Maps to same index in rewardPools
     */
    function _batchAddClaim(
        IMatrixToken matrixToken,
        address[] calldata rewardPools,
        string[] calldata integrationNames
    ) internal {
        uint256 poolArrayLength = _validateBatchArrays(rewardPools, integrationNames);
        for (uint256 i = 0; i < poolArrayLength; i++) {
            _addClaim(matrixToken, rewardPools[i], integrationNames[i]);
        }
    }

    /**
     * @dev Validates and stores the adapter address used to claim rewards for the passed rewardPool. If no adapters
     * left after removal then remove rewardPool from _rewardPools and delete entry in _claimSettings.
     *
     * @param matrixToken        Address of MatrixToken
     * @param rewardPool         Address of the rewardPool that identifies the contract governing claims
     * @param integrationName    ID of claim module integration (mapping on integration registry)
     */
    function _removeClaim(
        IMatrixToken matrixToken,
        address rewardPool,
        string calldata integrationName
    ) internal {
        address adapter = getAndValidateAdapter(integrationName);
        require(claimSettingsStatus[matrixToken][rewardPool][adapter], "CM3");

        _claimSettings[matrixToken][rewardPool].quickRemoveItem(adapter);
        claimSettingsStatus[matrixToken][rewardPool][adapter] = false;

        if (_claimSettings[matrixToken][rewardPool].length == 0) {
            _rewardPools[matrixToken].quickRemoveItem(rewardPool);
            _rewardPoolStatus[matrixToken][rewardPool] = false;
        }
    }

    // ==================== Private functions ====================

    /**
     * @dev For batch functions validate arrays are of equal length and not empty. Return length of array for iteration.
     *
     * @param rewardPools         Addresses of the rewardPool that identifies the contract governing claims
     * @param integrationNames    IDs of claim module integration (mapping on integration registry)
     *
     * @return uint256            Length of arrays
     */
    function _validateBatchArrays(address[] memory rewardPools, string[] calldata integrationNames) private pure returns (uint256) {
        uint256 poolArrayLength = rewardPools.length;

        require(poolArrayLength > 0, "CM4a");
        require(poolArrayLength == integrationNames.length, "CM4b");

        return poolArrayLength;
    }

    function _onlyValidCaller(IMatrixToken matrixToken) private view {
        require(_anyoneClaim[matrixToken] || isMatrixManager(matrixToken, msg.sender), "CM5");
    }
}
