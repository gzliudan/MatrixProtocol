// SPDX-License-Identifier: agpl-3.0

// Copy from https://github.com/aave/incentives-controller/blob/master/contracts/incentives/StakedTokenIncentivesController.sol under terms of agpl-3.0 with slight modifications

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ==================== Internal Imports ====================

import { IStakedTokenWithConfig } from "../../interfaces/external/aave-v2/IStakedTokenWithConfig.sol";

import { BaseIncentivesController } from "./BaseIncentivesController.sol";

/**
 * @title StakedTokenIncentivesController
 * @notice Distributor contract for rewards to the Aave protocol, using a staked token as rewards asset.
 * The contract stakes the rewards before redistributing them to the Aave protocol participants.
 * The reference staked token implementation is at https://github.com/aave/aave-stake-v2
 * @author Aave
 */
contract StakedTokenIncentivesController is BaseIncentivesController {
  using SafeERC20 for IERC20;

  IStakedTokenWithConfig public immutable STAKE_TOKEN;

  constructor(IStakedTokenWithConfig stakeToken, address emissionManager)
    BaseIncentivesController(IERC20(address(stakeToken)), emissionManager)
  {
    STAKE_TOKEN = stakeToken;
  }

  /**
   * @dev Initialize IStakedTokenIncentivesController
   */
  function initialize() external initializer {
    //approves the safety module to allow staking
    IERC20(STAKE_TOKEN.STAKED_TOKEN()).safeApprove(address(STAKE_TOKEN), type(uint256).max);
  }

  /// @inheritdoc BaseIncentivesController
  function _transferRewards(address to, uint256 amount) internal override {
    STAKE_TOKEN.stake(to, amount);
  }
}
