// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ==================== Internal Imports ====================

import { ModuleBase } from "../lib/ModuleBase.sol";

import { IController } from "../../interfaces/IController.sol";
import { IMatrixToken } from "../../interfaces/IMatrixToken.sol";
import { IGovernanceAdapter } from "../../interfaces/IGovernanceAdapter.sol";

/**
 * @title GovernanceModule
 *
 * @dev This module that enables participating in governance of component tokens held in the MatrixToken.
 * Examples of intended protocols include Compound, Uniswap, and Maker governance.
 */
contract GovernanceModule is ModuleBase, ReentrancyGuard {
    // ==================== Events ====================

    event VoteProposal(IMatrixToken indexed matrixToken, IGovernanceAdapter indexed governanceAdapter, uint256 indexed proposalId, bool support);
    event DelegateVote(IMatrixToken indexed matrixToken, IGovernanceAdapter indexed governanceAdapter, address delegatee);
    event CreateProposal(IMatrixToken indexed matrixToken, IGovernanceAdapter indexed governanceAdapter, bytes proposalData);
    event SubmitRegistration(IMatrixToken indexed matrixToken, IGovernanceAdapter indexed governanceAdapter);
    event RevokeRegistration(IMatrixToken indexed matrixToken, IGovernanceAdapter indexed governanceAdapter);

    // ==================== Constructor function ====================

    constructor(IController controller) ModuleBase(controller) {}

    // ==================== External functions ====================

    /**
     * @dev MANAGER ONLY. Delegate voting power to an Ethereum address.
     * @notice for some governance adapters, delegating to self is equivalent to registering and delegating to zero address is revoking right to vote.
     *
     * @param matrixToken       Address of MatrixToken
     * @param governanceName    Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param delegatee         Address of delegatee
     */
    function delegate(
        IMatrixToken matrixToken,
        string memory governanceName,
        address delegatee
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(governanceName));
        (address targetExchange, uint256 callValue, bytes memory methodData) = governanceAdapter.getDelegateCallData(delegatee);
        matrixToken.invoke(targetExchange, callValue, methodData);

        emit DelegateVote(matrixToken, governanceAdapter, delegatee);
    }

    /**
     * @dev MANAGER ONLY. Create a new proposal for a specified governance protocol.
     *
     * @param matrixToken       Address of MatrixToken
     * @param governanceName    Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param proposalData      Byte data of proposal to pass into governance adapter
     */
    function propose(
        IMatrixToken matrixToken,
        string memory governanceName,
        bytes memory proposalData
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(governanceName));
        (address targetExchange, uint256 callValue, bytes memory methodData) = governanceAdapter.getProposeCallData(proposalData);
        matrixToken.invoke(targetExchange, callValue, methodData);

        emit CreateProposal(matrixToken, governanceAdapter, proposalData);
    }

    /**
     * @dev MANAGER ONLY. Register for voting for the MatrixToken
     *
     * @param matrixToken       Address of MatrixToken
     * @param governanceName    Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     */
    function register(IMatrixToken matrixToken, string memory governanceName) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(governanceName));
        (address targetExchange, uint256 callValue, bytes memory methodData) = governanceAdapter.getRegisterCallData(address(matrixToken));
        matrixToken.invoke(targetExchange, callValue, methodData);

        emit SubmitRegistration(matrixToken, governanceAdapter);
    }

    /**
     * @dev MANAGER ONLY. Revoke voting for the MatrixToken
     *
     * @param matrixToken       Address of MatrixToken
     * @param governanceName    Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     */
    function revoke(IMatrixToken matrixToken, string memory governanceName) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(governanceName));
        (address targetExchange, uint256 callValue, bytes memory methodData) = governanceAdapter.getRevokeCallData();
        matrixToken.invoke(targetExchange, callValue, methodData);

        emit RevokeRegistration(matrixToken, governanceAdapter);
    }

    /**
     * @dev MANAGER ONLY. Cast vote for a specific governance token held in the MatrixToken.
     * Manager specifies whether to vote for or against a given proposal.
     *
     * @param matrixToken       Address of MatrixToken
     * @param governanceName    Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param proposalId        ID of the proposal to vote on
     * @param support           Wwhether to support proposal
     * @param data              Arbitrary bytes to be used to construct vote call data
     */
    function vote(
        IMatrixToken matrixToken,
        string memory governanceName,
        uint256 proposalId,
        bool support,
        bytes memory data
    ) external nonReentrant onlyManagerAndValidMatrix(matrixToken) {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(governanceName));
        (address targetExchange, uint256 callValue, bytes memory methodData) = governanceAdapter.getVoteCallData(proposalId, support, data);
        matrixToken.invoke(targetExchange, callValue, methodData);

        emit VoteProposal(matrixToken, governanceAdapter, proposalId, support);
    }

    /**
     * @dev Initializes this module to the MatrixToken. Only callable by the MatrixToken's manager.
     *
     * @param matrixToken    Instance of the MatrixToken to issue
     */
    function initialize(IMatrixToken matrixToken) external onlyMatrixManager(matrixToken, msg.sender) onlyValidAndPendingMatrix(matrixToken) {
        matrixToken.initializeModule();
    }

    /**
     * @dev Removes this module from the MatrixToken, via call by the MatrixToken.
     */
    function removeModule() external override {}
}
