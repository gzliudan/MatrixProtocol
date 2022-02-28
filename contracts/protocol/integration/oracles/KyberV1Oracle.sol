// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ==================== Internal Imports ====================

import { IOracle } from "../../../interfaces/IOracle.sol";
import { IDMMRouter02 } from "../../../interfaces/external/kyber/IDMMRouter02.sol";

/**
 * @title KyberV1Oracle
 * @author Matrix
 *
 * @dev Oracle which returns price of asset1/asset2 from KyberSwap V1 exchange pool.
 */
contract KyberV1Oracle is IOracle {
    // ==================== Variables ====================

    string internal _name;
    address internal immutable _router; // Address of KyberSwap V1 DMMRouter02
    address[] _poolsPath;
    IERC20[] _path;

    // ==================== Constructor function ====================

    constructor(
        string memory name,
        address router,
        address pool,
        address asset1,
        address asset2
    ) {
        require(router != address(0), "KO0a"); // "zero router"
        require(pool != address(0), "KO0b"); // "zero pool"
        require(asset1 != address(0), "KO0c"); // "zero asset1"
        require(asset2 != address(0), "KO0d"); // "zero asset2"
        require(asset1 != asset2, "KO0e"); // "same assets"

        _name = name;
        _router = router;

        _poolsPath = new address[](1);
        _poolsPath[0] = pool;

        _path = new IERC20[](2);
        _path[0] = IERC20(asset1);
        _path[1] = IERC20(asset2);
    }

    // ==================== External functions ====================

    function getInfo()
        external
        view
        returns (
            string memory name,
            address router,
            address pool,
            address asset1,
            address asset2
        )
    {
        return (_name, _router, _poolsPath[0], address(_path[0]), address(_path[1]));
    }

    /**
     * @dev Returns the latest price, multiplied by 1e18, assume amountOut is 1e18:
     * price = amountIn * 1e18 / amountOut = amountIn * 1e18 / 1e18 = amountIn
     */
    function read() external view returns (uint256 price) {
        uint256[] memory amounts = IDMMRouter02(_router).getAmountsIn(1e18, _poolsPath, _path);
        price = amounts[0];
    }
}
