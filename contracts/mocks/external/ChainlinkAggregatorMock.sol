// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @title ChainlinkAggregatorMock
 * @author Matrix
 */
contract ChainlinkAggregatorMock {
    int256 internal _latestAnswer;
    uint80 internal _latestRoundId;
    uint256 internal _latestStartedAt;
    uint256 internal _latestUpdatedAt;
    uint80 internal _latestAnsweredInRound;
    uint8 internal _decimals;

    // ==================== Constructor function ====================

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    // ==================== External functions ====================

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @dev set BaseToken oracle to 100 when decimals is 6: await mockAggregator.setLatestAnswer(ethers.utils.parseUnits("100", 6));
    function setLatestAnswer(int256 latestAnswer) external {
        _latestAnswer = latestAnswer;
    }

    /// @dev set BaseToken oracle to 100 when decimals is 6: await mockAggregator.setRoundData(0, ethers.utils.parseUnits("100", 6), 0, 0, 0);
    function setRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _latestRoundId = roundId;
        _latestAnswer = answer;
        _latestStartedAt = startedAt;
        _latestUpdatedAt = updatedAt;
        _latestAnsweredInRound = answeredInRound;
    }

    function getRoundData(
        uint80 /* _roundId */
    )
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_latestRoundId, _latestAnswer, _latestStartedAt, _latestUpdatedAt, _latestAnsweredInRound);
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_latestRoundId, _latestAnswer, _latestStartedAt, _latestUpdatedAt, _latestAnsweredInRound);
    }
}
