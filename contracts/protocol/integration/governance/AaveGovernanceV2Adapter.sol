// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title AaveGovernanceV2Adapter
 *
 * Governance adapter for Aave governance that returns data for voting, delegating, and creating proposals
 */
contract AaveGovernanceV2Adapter {
    // ==================== Constants ====================

    // Signature of delegate function
    string public constant DELEGATE_SIGNATURE = "delegate(address)";

    // Signature of vote function
    string public constant VOTE_SIGNATURE = "submitVote(uint256,bool)";

    // Signature of propose function
    string public constant PROPOSE_SIGNATURE = "create(address,address[],uint256[],string[],bytes[],bool[],bytes32)";

    // ==================== Variables ====================

    // Address of Aave proto governance contract
    address public immutable _aaveGovernanceV2;

    // Address of the Aave token
    address public immutable _aaveToken;

    // ==================== Constructor function ====================

    /**
     * @param aaveGovernanceV2    Address of AAVE Governance V2 contract
     */
    constructor(address aaveGovernanceV2, address aaveToken) {
        _aaveGovernanceV2 = aaveGovernanceV2;
        _aaveToken = aaveToken;
    }

    // ==================== External functions ====================

    /**
     * @dev Generates the calldata to vote on a proposal.
     *
     * @param proposalId    ID of the proposal to vote on
     * @param support       Boolean indicating whether to support proposal
     *
     * @return address      Target contract address
     * @return uint256      Total quantity of ETH (Set to 0)
     * @return bytes        Propose calldata
     */
    function getVoteCalldata(
        uint256 proposalId,
        bool support,
        bytes memory /* data */
    )
        external
        view
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        bytes memory callData = abi.encodeWithSignature(VOTE_SIGNATURE, proposalId, support);
        return (_aaveGovernanceV2, 0, callData);
    }

    /**
     * @dev Generates the calldata to delegate votes to another ETH address.
     * Self and zero address allowed, which is equivalent to registering and revoking in Aave.
     *
     * @param delegatee    Address of the delegatee
     *
     * @return address     Target contract address
     * @return uint256     Total quantity of ETH (Set to 0)
     * @return bytes       Propose calldata
     */
    function getDelegateCalldata(address delegatee)
        external
        view
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        bytes memory callData = abi.encodeWithSignature(DELEGATE_SIGNATURE, delegatee);
        return (_aaveToken, 0, callData);
    }

    /**
     * @dev Generates the calldata to create a new proposal.
     * The caller must have proposition power higher than PROPOSITION_THRESHOLD to create a proposal.
     * Executor is a contract deployed to validate proposal creation and voting.
     * There two types of proposals and each has it's own executor.
     * Critical proposals that affect governance consensus (long) and proposals affecting only protocol parameters (short).
     * https://docs.aave.com/developers/protocol-governance/governance#proposal-types
     *
     * @param proposalData    Byte data containing data about the proposal
     *
     * @return address        Target contract address
     * @return uint256        Total quantity of ETH (Set to 0)
     * @return bytes          Propose calldata
     */
    function getProposeCalldata(bytes memory proposalData)
        external
        view
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        (
            address executor,
            address[] memory targets,
            uint256[] memory values,
            string[] memory signatures,
            bytes[] memory calldatas,
            bool[] memory withDelegateCalls,
            bytes32 ipfsHash
        ) = abi.decode(proposalData, (address, address[], uint256[], string[], bytes[], bool[], bytes32));

        bytes memory callData = abi.encodeWithSignature(PROPOSE_SIGNATURE, executor, targets, values, signatures, calldatas, withDelegateCalls, ipfsHash);

        return (_aaveGovernanceV2, 0, callData);
    }

    /**
     * @dev Reverts as AAVE currently does not have a register mechanism in governance
     */
    function getRegisterCalldata(
        address /* matrixToken */
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // No register available in AAVE governance
        revert("AGbA1");
    }

    /**
     * Reverts as AAVE currently does not have a revoke mechanism in governance
     */
    function getRevokeCalldata()
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // No revoke available in AAVE governance
        revert("AGbA2");
    }
}
