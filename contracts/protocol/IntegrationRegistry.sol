// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

// ==================== Internal Imports ====================

import { IController } from "../interfaces/IController.sol";
import { IIntegrationRegistry } from "../interfaces/IIntegrationRegistry.sol";

/**
 * @title IntegrationRegistry
 *
 * @dev IntegrationRegistry holds state relating to the Modules and the integrations they are connected with.
 * The state is combined into a single Registry to allow governance updates to be aggregated to one contract.
 */
contract IntegrationRegistry is AccessControl, IIntegrationRegistry {
    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Variables ====================

    IController internal immutable _controller;

    // module => integration identifier => adapter address
    mapping(address => mapping(bytes32 => address)) private _integrations;

    // ==================== Constructor function ====================

    constructor(IController controller) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _controller = controller;
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function getController() external view returns (address) {
        return address(_controller);
    }

    function getIntegrationAdapter(address module, string memory name) external view returns (address) {
        return _integrations[module][_hashName(name)];
    }

    function getIntegrationAdapterWithHash(address module, bytes32 nameHash) external view returns (address) {
        return _integrations[module][nameHash];
    }

    function isValidIntegration(address module, string memory name) external view returns (bool) {
        return _integrations[module][_hashName(name)] != address(0);
    }

    /**
     * @dev GOVERNANCE FUNCTION: Add a new integration to the registry
     *
     * @param module     The address of the module associated with the integration
     * @param name       Human readable string identifying the integration
     * @param adapter    Address of the adapter contract to add
     */
    function addIntegration(
        address module,
        string memory name,
        address adapter
    ) external onlyAdmin {
        _addIntegration(module, name, adapter);
    }

    /**
     * @dev GOVERNANCE FUNCTION: Batch add new adapters. Reverts if exists on any module and name
     *
     * @param modules     Array of addresses of the modules associated with integration
     * @param names       Array of human readable strings identifying the integration
     * @param adapters    Array of addresses of the adapter contracts to add
     */
    function batchAddIntegration(
        address[] memory modules,
        string[] memory names,
        address[] memory adapters
    ) external onlyAdmin {
        uint256 modulesCount = modules.length;
        require(modulesCount > 0, "R0a");
        require(modulesCount == names.length, "R0b");
        require(modulesCount == adapters.length, "R0c");

        for (uint256 i = 0; i < modulesCount; i++) {
            _addIntegration(modules[i], names[i], adapters[i]);
        }
    }

    /**
     * @dev GOVERNANCE FUNCTION: Edit an existing integration on the registry
     *
     * @param module     The address of the module associated with the integration
     * @param name       Human readable string identifying the integration
     * @param adapter    Address of the adapter contract to edit
     */
    function editIntegration(
        address module,
        string memory name,
        address adapter
    ) external onlyAdmin {
        _editIntegration(module, name, adapter);
    }

    /**
     * @dev GOVERNANCE FUNCTION: Batch edit adapters for modules. Reverts if module and
     * adapter name don't map to an adapter address
     *
     * @param modules     Array of addresses of the modules associated with integration
     * @param names       Array of human readable strings identifying the integration
     * @param adapters    Array of addresses of the adapter contracts to add
     */
    function batchEditIntegration(
        address[] memory modules,
        string[] memory names,
        address[] memory adapters
    ) external onlyAdmin {
        uint256 modulesCount = modules.length;
        require(modulesCount > 0, "R1a");
        require(modulesCount == names.length, "R1b");
        require(modulesCount == adapters.length, "R1c");

        for (uint256 i = 0; i < modulesCount; i++) {
            _editIntegration(modules[i], names[i], adapters[i]);
        }
    }

    /**
     * @dev GOVERNANCE FUNCTION: Remove an existing integration on the registry
     *
     * @param module    The address of the module associated with the integration
     * @param name      Human readable string identifying the integration
     */
    function removeIntegration(address module, string memory name) external onlyAdmin {
        bytes32 hashedName = _hashName(name);
        require(_integrations[module][hashedName] != address(0), "R2");

        address oldAdapter = _integrations[module][hashedName];
        delete _integrations[module][hashedName];

        emit RemoveIntegration(module, oldAdapter, name);
    }

    // ==================== Internal functions ====================

    /**
     * @dev Hashes the string and returns a bytes32 value
     */
    function _hashName(string memory name) internal pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    function _addIntegration(
        address module,
        string memory name,
        address adapter
    ) internal {
        require(adapter != address(0), "R3a");
        require(_controller.isModule(module), "R3b");
        bytes32 hashedName = _hashName(name);
        require(_integrations[module][hashedName] == address(0), "R3c");

        _integrations[module][hashedName] = adapter;

        emit AddIntegration(module, adapter, name);
    }

    function _editIntegration(
        address module,
        string memory name,
        address adapter
    ) internal {
        require(adapter != address(0), "R4a");
        require(_controller.isModule(module), "R4b");
        bytes32 hashedName = _hashName(name);
        require(_integrations[module][hashedName] != address(0), "R4c");

        _integrations[module][hashedName] = adapter;

        emit EditIntegration(module, adapter, name);
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "R5");
    }
}
