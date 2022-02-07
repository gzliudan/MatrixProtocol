// SPDX-License-Identifier: BUSL-1.1

// Copy from https://github.com/KyberNetwork/dmm-smart-contracts/blob/master/contracts/interfaces/IDMMRouter01.sol under terms of BUSL-1.1 with slight modifications

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { IWETH } from "../IWETH.sol";
import { IDMMExchangeRouter } from "./IDMMExchangeRouter.sol";
import { IDMMLiquidityRouter } from "./IDMMLiquidityRouter.sol";

/// @dev full interface for router
interface IDMMRouter01 is IDMMExchangeRouter, IDMMLiquidityRouter {
    function factory() external view returns (address);

    function weth() external view returns (IWETH);
}
