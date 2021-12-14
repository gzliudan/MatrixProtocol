// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== Internal Imports ====================

import { AddressArrayUtil } from "../lib/AddressArrayUtil.sol";

import { IController } from "../interfaces/IController.sol";

import { MatrixToken } from "./MatrixToken.sol";

/**
 * @title MatrixTokenFactory
 *
 * @dev MatrixTokenFactory is a smart contract used to deploy new MatrixToken contracts. This contract
 * is a Factory that is enabled by the controller to create and register new MatrixTokens.
 */
contract MatrixTokenFactory {
    using AddressArrayUtil for address[];

    // ==================== Variables ====================

    IController internal _controller;

    // ==================== Events ====================

    event CreateMatrixToken(address indexed matrixToken, address indexed manager, string name, string symbol);

    // ==================== Constructor function ====================

    constructor(IController controller) {
        _controller = controller;
    }

    // ==================== External functions ====================

    function getController() external view returns (address) {
        return address(_controller);
    }

    /**
     * @dev Creates a MatrixToken smart contract and registers the it with the controller.
     * The MatrixToken is composed of positions that are instantiated as DEFAULT (positionState = 0) state.
     *
     * @param components    List of addresses of components for initial Positions
     * @param units         List of units. Each unit is the # of components per 10^18 of a MatrixToken
     * @param modules       List of modules to enable. All modules must be approved by the Controller
     * @param manager       Address of the manager
     * @param name          Name of the MatrixToken
     * @param symbol        Symbol of the MatrixToken
     *
     * @return address      Address of the newly created MatrixToken
     */
    function create(
        address[] memory components,
        int256[] memory units,
        address[] memory modules,
        address manager,
        string memory name,
        string memory symbol
    ) external returns (address) {
        require(manager != address(0), "F0a");
        require(modules.length > 0, "F0b");
        require(components.length > 0, "F0c");
        require(components.length == units.length, "F0d");
        require(!components.hasDuplicate(), "F0e");

        for (uint256 i = 0; i < components.length; i++) {
            require(components[i] != address(0), "F0f");
            require(units[i] > 0, "F0g");
        }

        for (uint256 j = 0; j < modules.length; j++) {
            require(_controller.isModule(modules[j]), "F0h");
        }

        MatrixToken matrixToken = new MatrixToken(components, units, modules, _controller, manager, name, symbol);
        _controller.addMatrix(address(matrixToken));

        emit CreateMatrixToken(address(matrixToken), manager, name, symbol);

        return address(matrixToken);
    }
}
