// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title StakingAdapterMock
 *
 * @dev Staking Adapter that doubles as a mock Staking contract as well.
 */
contract StakingAdapterMock {
    using SafeMath for uint256;

    // ==================== Constants ====================

    uint256 public PRECISE_UNIT = 1e18;

    // ==================== Variables ====================

    mapping(address => uint256) internal _stakes;
    uint256 internal _unstakeFee;
    IERC20 internal _stakingAsset;

    // ==================== Constructor function ====================

    constructor(IERC20 stakingAsset) {
        _stakingAsset = stakingAsset;
    }

    // ==================== External functions ====================

    function stake(uint256 amount) external {
        _stakingAsset.transferFrom(msg.sender, address(this), amount);
        _stakes[msg.sender] = _stakes[msg.sender].add(amount);
    }

    function unstake(uint256 amount) external {
        _stakes[msg.sender] = _stakes[msg.sender].sub(amount);
        _stakingAsset.transfer(msg.sender, amount.mul(PRECISE_UNIT.sub(_unstakeFee)).div(PRECISE_UNIT));
    }

    function setUnstakeFee(uint256 fee) external {
        _unstakeFee = fee;
    }

    function getStakeCallData(address stakingContract, uint256 notionalAmount)
        external
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = stakingContract;
        callData = abi.encodeWithSignature("stake(uint256)", notionalAmount);
    }

    function getUnstakeCallData(address stakingContract, uint256 notionalAmount)
        external
        pure
        returns (
            address target,
            uint256 value,
            bytes memory callData
        )
    {
        value = 0;
        target = stakingContract;
        callData = abi.encodeWithSignature("unstake(uint256)", notionalAmount);
    }

    function getSpenderAddress(
        address /* _pool */
    ) external view returns (address) {
        return address(this);
    }
}
