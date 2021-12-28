// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title AaveGovernanceAdapter
 *
 * @dev Governance adapter for Aave governance that returns data for voting
 */
contract AaveGovernanceAdapter {
    // ==================== Constants ====================

    // 1 is a vote for in AAVE
    uint256 public constant VOTE_FOR = 1;

    // 2 represents a vote against in AAVE
    uint256 public constant VOTE_AGAINST = 2;

    // ==================== Variables ====================

    // Address of Aave proto governance contract
    address public immutable _aaveProtoGovernance;

    // Address of Aave token
    address public immutable _aaveToken;

    // ==================== Constructor function ====================

    /**
     * @param aaveProtoGovernance    Address of AAVE proto governance contract
     * @param aaveToken              Address of AAVE token
     */
    constructor(address aaveProtoGovernance, address aaveToken) {
        _aaveProtoGovernance = aaveProtoGovernance;
        _aaveToken = aaveToken;
    }

    // ==================== External functions ====================

    /**
     * @dev Generates the calldata to vote on a proposal. If byte data is empty,
     * then vote using AAVE token, otherwise, vote using the asset passed into the function
     *
     * @param proposalId    ID of the proposal to vote on
     * @param support       Boolean indicating whether to support proposal
     * @param data          Byte data containing the asset to vote with
     *
     * @return address      Target contract address
     * @return uint256      Total quantity of ETH (Set to 0)
     * @return bytes        Propose calldata
     */
    function getVoteCalldata(
        uint256 proposalId,
        bool support,
        bytes memory data
    )
        external
        view
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        uint256 voteValue = support ? VOTE_FOR : VOTE_AGAINST;
        address asset = data.length == 0 ? _aaveToken : abi.decode(data, (address));

        // submitVoteByVoter(uint256 _proposalId, uint256 _vote, IERC20 _asset)
        bytes memory callData = abi.encodeWithSignature("submitVoteByVoter(uint256,uint256,address)", proposalId, voteValue, asset);

        return (_aaveProtoGovernance, 0, callData);
    }

    /**
     * @dev Reverts as AAVE currently does not have a delegation mechanism in governance
     */
    function getDelegateCalldata(
        address /* delegatee */
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // No delegation available in AAVE governance
        revert("AGA1");
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
        revert("AGA2");
    }

    /**
     * @dev Reverts as AAVE currently does not have a revoke mechanism in governance
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
        revert("AGA3");
    }

    /**
     * @dev Reverts as creating a proposal is only available to AAVE genesis team
     */
    function getProposeCalldata(
        bytes memory /* proposalData */
    )
        external
        pure
        returns (
            address,
            uint256,
            bytes memory
        )
    {
        // Creation of new proposal only available to AAVE genesis team
        revert("AGA4");
    }
}
