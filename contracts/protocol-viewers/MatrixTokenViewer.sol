// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";

import { IMatrixToken } from "../interfaces/IMatrixToken.sol";

/**
 * @title MatrixTokenViewer
 */
contract MatrixTokenViewer {
    using SafeCast for int256;
    using PreciseUnitMath for uint256;

    // ==================== Structs ====================

    struct MatrixDetail {
        uint256 totalSupply;
        uint256 myBalance;
        address manager;
        string name;
        string symbol;
        address[] modules;
        IMatrixToken.ModuleState[] moduleStatuses;
        IMatrixToken.Position[] positions;
    }

    // ==================== External functions ====================

    function batchFetchDetails(IMatrixToken[] calldata matrixTokens, address[] calldata modules) external view returns (MatrixDetail[] memory details) {
        details = new MatrixDetail[](matrixTokens.length);
        for (uint256 i = 0; i < matrixTokens.length; i++) {
            details[i] = fetchDetail(matrixTokens[i], modules);
        }
    }

    function batchFetchModuleStates(IMatrixToken[] calldata matrixTokens, address[] calldata modules)
        external
        view
        returns (IMatrixToken.ModuleState[][] memory states)
    {
        states = new IMatrixToken.ModuleState[][](matrixTokens.length);
        for (uint256 i = 0; i < matrixTokens.length; i++) {
            states[i] = fetchModuleStates(matrixTokens[i], modules);
        }
    }

    function batchFetchManagers(IMatrixToken[] calldata matrixTokens) external view returns (address[] memory) {
        address[] memory managers = new address[](matrixTokens.length);

        for (uint256 i = 0; i < matrixTokens.length; i++) {
            managers[i] = matrixTokens[i].getManager();
        }

        return managers;
    }

    function batchFetchAirdropAmounts(IMatrixToken[] calldata matrixTokens, address[] calldata tokens) public view returns (uint256[][] memory result) {
        result = new uint256[][](matrixTokens.length);
        for (uint256 i = 0; i < matrixTokens.length; i++) {
            result[i] = fetchAirdropAmounts(matrixTokens[i], tokens);
        }
    }

    // ==================== Public functions ====================

    function fetchAirdropAmount(IMatrixToken matrixToken, address token) public view returns (uint256) {
        uint256 tokenBalance = IERC20(token).balanceOf(address(matrixToken));
        int256 positionUnit = matrixToken.getDefaultPositionRealUnit(token);

        return tokenBalance - matrixToken.totalSupply().preciseMul(positionUnit.toUint256());
    }

    function fetchAirdropAmounts(IMatrixToken matrixToken, address[] calldata tokens) public view returns (uint256[] memory amounts) {
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = fetchAirdropAmount(matrixToken, tokens[i]);
        }
    }

    function fetchModuleStates(IMatrixToken matrixToken, address[] calldata modules) public view returns (IMatrixToken.ModuleState[] memory states) {
        states = new IMatrixToken.ModuleState[](modules.length);

        for (uint256 i = 0; i < modules.length; i++) {
            states[i] = matrixToken.getModuleState(modules[i]);
        }
    }

    function fetchDetail(IMatrixToken matrixToken, address[] calldata modules) public view returns (MatrixDetail memory) {
        return
            MatrixDetail({
                totalSupply: matrixToken.totalSupply(),
                myBalance: matrixToken.balanceOf(msg.sender),
                manager: matrixToken.getManager(),
                name: ERC20(address(matrixToken)).name(),
                symbol: ERC20(address(matrixToken)).symbol(),
                modules: matrixToken.getModules(),
                moduleStatuses: fetchModuleStates(matrixToken, modules),
                positions: matrixToken.getPositions()
            });
    }
}
