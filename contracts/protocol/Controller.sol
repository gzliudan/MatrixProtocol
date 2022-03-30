// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../lib/AddressArrayUtil.sol";

import { IController } from "../interfaces/IController.sol";
import { IMatrixToken } from "../interfaces/IMatrixToken.sol";
import { IPriceOracle } from "../interfaces/IPriceOracle.sol";
import { IMatrixValuer } from "../interfaces/IMatrixValuer.sol";
import { IIntegrationRegistry } from "../interfaces/IIntegrationRegistry.sol";

/**
 * @title Controller
 *
 * @dev houses state for approvals and system contracts such as added matrix,
 * modules, factories, resources (like price oracles), and protocol fee configurations.
 */
contract Controller is AccessControlEnumerable, IController {
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // IntegrationRegistry will always be resource ID 0 in the system
    uint256 internal constant INTEGRATION_REGISTRY_RESOURCE_ID = 0;

    // PriceOracle will always be resource ID 1 in the system
    uint256 internal constant PRICE_ORACLE_RESOURCE_ID = 1;

    // MatrixValuer resource will always be resource ID 2 in the system
    uint256 internal constant MATRIX_VALUER_RESOURCE_ID = 2;

    // ==================== Variables ====================

    // Enabled matrixs
    address[] internal _matrixs;

    // Enabled factories of MatrixToken
    address[] internal _factories;

    // Enabled Modules; Modules extend the functionality of MatrixToken
    address[] internal _modules;

    // Enabled Resources; Resources provide data, functionality, or permissions that can be drawn upon from Module, MatrixToken or factories
    address[] internal _resources;

    // Mappings to check whether address is valid Matrix, Factory, Module or Resource
    mapping(address => bool) internal _isMatrix;
    mapping(address => bool) internal _isFactory;
    mapping(address => bool) internal _isModule;
    mapping(address => bool) internal _isResource;

    // Mapping of modules to fee types to fee percentage. A module can have multiple feeTypes. Fee is denominated in precise unit percentages (100% = 1e18, 1% = 1e16)
    mapping(address => mapping(uint256 => uint256)) internal _fees;

    // Resource ID => resource address, allows contracts to fetch the correct resource while providing an ID
    mapping(uint256 => address) internal _resourceIds;

    // Recipient of protocol fees
    address internal _feeRecipient;

    bool internal _isInitialized;

    // ==================== Constructor function ====================

    /**
     * @param feeRecipient    Address of the initial protocol fee recipient
     */
    constructor(address feeRecipient) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _feeRecipient = feeRecipient;
    }

    // ==================== Modifier functions ====================

    modifier onlyFactory() {
        _onlyFactory();
        _;
    }

    modifier onlyInitialized() {
        _onlyInitialized();
        _;
    }

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function isInitialized() external view returns (bool) {
        return _isInitialized;
    }

    function isMatrix(address addr) external view returns (bool) {
        return _isMatrix[addr];
    }

    function isFactory(address addr) external view returns (bool) {
        return _isFactory[addr];
    }

    function isModule(address addr) external view returns (bool) {
        return _isModule[addr];
    }

    function isResource(address addr) external view returns (bool) {
        return _isResource[addr];
    }

    /**
     * @dev Check if a contract address is a matrix, module, resource, factory or controller
     *
     * @param addr    The contract address to check
     */
    function isSystemContract(address addr) external view returns (bool) {
        return (_isMatrix[addr] || _isModule[addr] || _isResource[addr] || _isFactory[addr] || addr == address(this));
    }

    function getFeeRecipient() external view returns (address) {
        return _feeRecipient;
    }

    function getModuleFee(address moduleAddress, uint256 feeType) external view returns (uint256) {
        return _fees[moduleAddress][feeType];
    }

    function getFactories() external view returns (address[] memory) {
        return _factories;
    }

    function getModules() external view returns (address[] memory) {
        return _modules;
    }

    function getResources() external view returns (address[] memory) {
        return _resources;
    }

    function getResource(uint256 id) external view returns (address) {
        return _resourceIds[id];
    }

    function getMatrixs() external view returns (address[] memory) {
        return _matrixs;
    }

    /**
     * @dev Gets the instance of integration registry stored on Controller.
     * @notice IntegrationRegistry is stored as index 0 on the Controller.
     */
    function getIntegrationRegistry() external view returns (IIntegrationRegistry) {
        return IIntegrationRegistry(_resourceIds[INTEGRATION_REGISTRY_RESOURCE_ID]);
    }

    /**
     * @dev Gets instance of price oracle on Controller.
     * @notice PriceOracle is stored as index 1 on the Controller.
     */
    function getPriceOracle() external view returns (IPriceOracle) {
        return IPriceOracle(_resourceIds[PRICE_ORACLE_RESOURCE_ID]);
    }

    /**
     * @dev Gets the instance of matrix valuer on Controller.
     * @notice MatrixValuer is stored as index 2 on the Controller.
     */
    function getMatrixValuer() external view returns (IMatrixValuer) {
        return IMatrixValuer(_resourceIds[MATRIX_VALUER_RESOURCE_ID]);
    }

    /**
     * @dev Initializes any predeployed factories, modules, and resources post deployment.
     * @notice This function can only be called by the owner once to batch initialize the initial system contracts.
     *
     * @param factories      factories to add
     * @param modules        modules to add
     * @param resources      resources to add
     * @param resourceIds    resource IDs associated with the resources
     */
    function initialize(
        address[] memory factories,
        address[] memory modules,
        address[] memory resources,
        uint256[] memory resourceIds
    ) external onlyAdmin {
        require(!_isInitialized, "C0a");
        require(resources.length == resourceIds.length, "C0b");

        _factories = factories;
        _modules = modules;
        _resources = resources;

        // Loop through and initialize isModule, isFactory, and isResource mapping
        for (uint256 i = 0; i < factories.length; i++) {
            address factory = factories[i];
            require(factory != address(0), "C0c");

            _isFactory[factory] = true;
        }

        for (uint256 i = 0; i < modules.length; i++) {
            address module = modules[i];
            require(module != address(0), "C0d");

            _isModule[module] = true;
        }

        for (uint256 i = 0; i < resources.length; i++) {
            address resource = resources[i];
            require(resource != address(0), "C0e");

            uint256 resourceId = resourceIds[i];
            require(_resourceIds[resourceId] == address(0), "C0f");

            _isResource[resource] = true;
            _resourceIds[resourceId] = resource;
        }

        _isInitialized = true;
    }

    /**
     * @dev PRIVILEGED FACTORY FUNCTION. Adds a newly deployed MatrixToken as an enabled MatrixToken.
     *
     * @param matrixToken    Address of the MatrixToken contract to add
     */
    function addMatrix(address matrixToken) external onlyInitialized onlyFactory {
        require(!_isMatrix[matrixToken], "C1");

        _isMatrix[matrixToken] = true;
        _matrixs.push(matrixToken);

        emit AddMatrix(matrixToken, msg.sender);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to remove a Set
     *
     * @param matrixToken    Address of the MatrixToken contract to remove
     */
    function removeMatrix(address matrixToken) external onlyInitialized onlyAdmin {
        require(_isMatrix[matrixToken], "C2");

        _matrixs.quickRemoveItem(matrixToken);
        _isMatrix[matrixToken] = false;

        emit RemoveMatrix(matrixToken);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to add a factory
     *
     * @param factory    Address of the factory contract to add
     */
    function addFactory(address factory) external onlyInitialized onlyAdmin {
        require(!_isFactory[factory], "C3");

        _isFactory[factory] = true;
        _factories.push(factory);

        emit AddFactory(factory);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to remove a factory
     *
     * @param factory    Address of the factory contract to remove
     */
    function removeFactory(address factory) external onlyInitialized onlyAdmin {
        require(_isFactory[factory], "C4");

        _factories.quickRemoveItem(factory);
        _isFactory[factory] = false;

        emit RemoveFactory(factory);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to add a module
     *
     * @param module    Address of the module contract to add
     */
    function addModule(address module) external onlyInitialized onlyAdmin {
        require(!_isModule[module], "C5");

        _isModule[module] = true;
        _modules.push(module);

        emit AddModule(module);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to remove a module
     *
     * @param module    Address of the module contract to remove
     */
    function removeModule(address module) external onlyInitialized onlyAdmin {
        require(_isModule[module], "C6");

        _modules.quickRemoveItem(module);
        _isModule[module] = false;

        emit RemoveModule(module);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to add a resource
     *
     * @param resource    Address of the resource contract to add
     * @param id          New ID of the resource contract
     */
    function addResource(address resource, uint256 id) external onlyInitialized onlyAdmin {
        require(!_isResource[resource], "C7a");
        require(_resourceIds[id] == address(0), "C7b");

        _isResource[resource] = true;
        _resourceIds[id] = resource;
        _resources.push(resource);

        emit AddResource(resource, id);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to remove a resource
     *
     * @param id    ID of the resource contract to remove
     */
    function removeResource(uint256 id) external onlyInitialized onlyAdmin {
        address resourceToRemove = _resourceIds[id];
        require(resourceToRemove != address(0), "C8");

        _resources.quickRemoveItem(resourceToRemove);
        delete _resourceIds[id];
        _isResource[resourceToRemove] = false;

        emit RemoveResource(resourceToRemove, id);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to add a fee to a module
     *
     * @param module              Address of the module contract to add fee to
     * @param feeType             Type of the fee to add in the module
     * @param newFeePercentage    Percentage of fee to add in the module (denominated in preciseUnits eg 1% = 1e16)
     */
    function addFee(
        address module,
        uint256 feeType,
        uint256 newFeePercentage
    ) external onlyInitialized onlyAdmin {
        require(_isModule[module], "C9a");
        require(_fees[module][feeType] == 0, "C9b");

        _fees[module][feeType] = newFeePercentage;

        emit AddFee(module, feeType, newFeePercentage);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to edit a fee in an existing module
     *
     * @param module              Address of the module contract to edit fee
     * @param feeType             Type of the fee to edit in the module
     * @param newFeePercentage    Percentage of fee to edit in the module (denominated in preciseUnits eg 1% = 1e16)
     */
    function editFee(
        address module,
        uint256 feeType,
        uint256 newFeePercentage
    ) external onlyInitialized onlyAdmin {
        require(_isModule[module], "C10a");
        require(_fees[module][feeType] != 0, "C10b");

        _fees[module][feeType] = newFeePercentage;

        emit EditFee(module, feeType, newFeePercentage);
    }

    /**
     * @dev PRIVILEGED GOVERNANCE FUNCTION. Allows governance to edit the protocol fee recipient
     *
     * @param newFeeRecipient    Address of the new protocol fee recipient
     */
    function editFeeRecipient(address newFeeRecipient) external onlyInitialized onlyAdmin {
        require(newFeeRecipient != address(0), "C11");

        _feeRecipient = newFeeRecipient;

        emit EditFeeRecipient(newFeeRecipient);
    }

    // ==================== Private functions ====================

    function _onlyFactory() private view {
        require(_isFactory[msg.sender], "C12");
    }

    function _onlyInitialized() private view {
        require(_isInitialized, "C13");
    }

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "C14");
    }
}
