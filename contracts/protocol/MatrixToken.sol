// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ==================== Internal Imports ====================

import { ExactSafeErc20 } from "../lib/ExactSafeErc20.sol";
import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../lib/AddressArrayUtil.sol";

import { IModule } from "../interfaces/IModule.sol";
import { IController } from "../interfaces/IController.sol";
import { IMatrixToken } from "../interfaces/IMatrixToken.sol";

/**
 * @title MatrixToken
 *
 * @dev This contract allows privileged modules to make modifications to its positions and invoke function calls from the MatrixToken.
 */
contract MatrixToken is ERC20, IMatrixToken {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using ExactSafeErc20 for IERC20;
    using PreciseUnitMath for int256;
    using PreciseUnitMath for uint256;
    using Address for address;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    // The PositionState is the status of the Position,
    uint8 internal constant DEFAULT = 0; // held on the MatrixToken
    uint8 internal constant EXTERNAL = 1; // held on a separate smart contract (whether a module or external source)

    // ==================== Variables ====================

    // Address of the controller
    IController internal _controller;

    // The manager has the privelege to add modules, remove, and set a new manager
    address internal _manager;

    // A module that has locked other modules from privileged functionality.
    // When locked, only the locker (a module) can call privileged functionality.
    // Typically utilized if a module (e.g. Auction) needs multiple transactions to complete an action without interruption
    address internal _locker;
    bool internal _isLocked;

    // List of initialized Modules; Modules extend the functionality of MatrixToken
    address[] internal _modules;

    // Modules are initialized from NONE -> PENDING -> INITIALIZED through the
    // addModule (called by manager) and initialize (called by module) functions
    mapping(address => IMatrixToken.ModuleState) internal _moduleStates;

    // List of components
    address[] internal _components;

    // component => ComponentPosition
    // Mapping that stores all Default and External position information for a given component.
    // Position quantities are represented as virtual units; Default positions are on the top-level,
    // while external positions are stored in a module array and accessed through its externalPositions mapping
    mapping(address => IMatrixToken.ComponentPosition) private _componentPositions;

    // The multiplier applied to the virtual position unit to achieve the real/actual unit.
    // This multiplier is used for efficiently modifying the entire position units (e.g. streaming fee)
    int256 internal _positionMultiplier;

    // ==================== Constructor function ====================

    /**
     * @dev When MatrixToken is created, initializes Positions in default state and adds modules into pending state.
     * The positionMultiplier as 1e18 (no adjustments).
     *
     * @param components    List of components
     * @param units         Each unit is the # of components per 10^18 of a MatrixToken
     * @param modules       Modules to enable, must be approved by the Controller
     * @param controller    Address of the controller
     * @param manager       Address of the manager
     * @param name          Name of the MatrixToken
     * @param symbol        Symbol of the MatrixToken
     */
    constructor(
        address[] memory components,
        int256[] memory units,
        address[] memory modules,
        IController controller,
        address manager,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        _controller = controller;
        _manager = manager;
        _positionMultiplier = PreciseUnitMath.preciseUnitInt();
        _components = components;

        // Modules are put in PENDING state, as they need to be individually initialized by the Module
        for (uint256 i = 0; i < modules.length; i++) {
            _moduleStates[modules[i]] = IMatrixToken.ModuleState.PENDING;
        }

        // Positions are put in default state initially
        for (uint256 j = 0; j < components.length; j++) {
            _componentPositions[components[j]].virtualUnit = units[j];
        }
    }

    // ==================== Receive function ====================

    receive() external payable {}

    // ==================== Modifier functions ====================

    // Throws if the sender is not a MatrixToken's module or module not enabled
    // Module must be initialized on the MatrixToken and enabled by the controller
    modifier onlyModule() {
        _onlyModule();
        _;
    }

    // Throws if the sender is not the MatrixToken's manager
    modifier onlyManager() {
        _onlyManager();
        _;
    }

    // Throws if MatrixToken is locked and called by any account other than the locker.
    modifier onlyLocker() {
        _onlyLocker();
        _;
    }

    // ==================== External functions ====================

    function getController() external view returns (address) {
        return address(_controller);
    }

    function getManager() external view returns (address) {
        return _manager;
    }

    function getLocker() external view returns (address) {
        return _locker;
    }

    function getComponents() external view returns (address[] memory) {
        return _components;
    }

    function getComponent(uint256 index) external view returns (address) {
        return _components[index];
    }

    function getModules() external view returns (address[] memory) {
        return _modules;
    }

    function getModuleState(address module) external view returns (IMatrixToken.ModuleState) {
        return _moduleStates[module];
    }

    function getPositionMultiplier() external view returns (int256) {
        return _positionMultiplier;
    }

    function getExternalPositionModules(address component) external view returns (address[] memory) {
        return _externalPositionModules(component);
    }

    function getExternalPositionData(address component, address positionModule) external view returns (bytes memory) {
        return _externalPositionData(component, positionModule);
    }

    /**
     * @dev Returns a list of Positions, through traversing the components. Each component with a non-zero virtual
     * unit is considered a Default Position, and each externalPositionModule will generate a unique position.
     * Virtual units are converted to real units. This function is typically used off-chain for data presentation purposes.
     */
    function getPositions() external view returns (IMatrixToken.Position[] memory) {
        IMatrixToken.Position[] memory positions = new IMatrixToken.Position[](_getPositionCount());
        uint256 positionCount = 0;

        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];

            // A default position exists if the default virtual unit is > 0
            if (_defaultPositionVirtualUnit(component) > 0) {
                positions[positionCount] = IMatrixToken.Position({
                    component: component,
                    module: address(0),
                    unit: getDefaultPositionRealUnit(component),
                    positionState: DEFAULT,
                    data: ""
                });

                positionCount++;
            }

            address[] memory externalModules = _externalPositionModules(component);
            for (uint256 j = 0; j < externalModules.length; j++) {
                address currentModule = externalModules[j];

                positions[positionCount] = IMatrixToken.Position({
                    component: component,
                    module: currentModule,
                    unit: getExternalPositionRealUnit(component, currentModule),
                    positionState: EXTERNAL,
                    data: _externalPositionData(component, currentModule)
                });

                positionCount++;
            }
        }

        return positions;
    }

    /**
     * @dev Returns the total Real Units for a given component, summing the default and external position units.
     */
    function getTotalComponentRealUnits(address component) external view returns (int256) {
        int256 totalUnits = getDefaultPositionRealUnit(component);

        address[] memory externalModules = _externalPositionModules(component);
        for (uint256 i = 0; i < externalModules.length; i++) {
            totalUnits += getExternalPositionRealUnit(component, externalModules[i]); // external position virtual unit can be negative
        }

        return totalUnits;
    }

    /**
     * @dev Only ModuleStates of INITIALIZED modules are considered enabled.
     */
    function isInitializedModule(address module) external view returns (bool) {
        return _moduleStates[module] == IMatrixToken.ModuleState.INITIALIZED;
    }

    /**
     * @dev True if the module is in a pending state.
     */
    function isPendingModule(address module) external view returns (bool) {
        return _moduleStates[module] == IMatrixToken.ModuleState.PENDING;
    }

    function isLocked() external view returns (bool) {
        return _isLocked;
    }

    /**
     * @dev Low level function that allows a module to make an arbitrary function call to any contract.
     *
     * @param target     Address of the smart contract to call
     * @param value      Quantity of Ether to provide the call (typically 0)
     * @param data       Encoded function selector and arguments
     *
     * @return result    Bytes encoded return value
     */
    function invoke(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyModule onlyLocker returns (bytes memory result) {
        result = target.functionCallWithValue(data, value);

        emit Invoke(target, value, data, result);

        return result;
    }

    /**
     * @dev MatrixToken to set approvals of the ERC20 token to a spender.
     */
    function invokeSafeIncreaseAllowance(
        address token,
        address spender,
        uint256 amount
    ) external onlyModule onlyLocker {
        IERC20(token).safeIncreaseAllowance(spender, amount);
    }

    /**
     * @dev MatrixToken transfer ERC20 token to recipient.
     */
    function invokeSafeTransfer(
        address token,
        address to,
        uint256 amount
    ) external onlyModule onlyLocker {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev MatrixToken transfer ERC20 tokens to recipient, and verify balance after transfer.
     */
    function invokeExactSafeTransfer(
        address token,
        address to,
        uint256 amount
    ) external onlyModule onlyLocker {
        IERC20(token).exactSafeTransfer(to, amount);
    }

    function invokeWrapWETH(address weth, uint256 amount) external onlyModule onlyLocker {
        // IWETH(weth).deposit{ value: amount }();
        bytes memory callData = abi.encodeWithSignature("deposit()");
        weth.functionCallWithValue(callData, amount, "invokeWrapWETH fail");
    }

    function invokeUnwrapWETH(address weth, uint256 amount) external onlyModule onlyLocker {
        // IWETH(weth).withdraw(amount);
        bytes memory callData = abi.encodeWithSignature("withdraw(uint256)", amount);
        weth.functionCallWithValue(callData, 0, "invokeUnwrapWETH fail");
    }

    // Low level function that adds a component to the components array.
    function addComponent(address component) external onlyModule onlyLocker {
        require(!isComponent(component), "T0");

        _components.push(component);

        emit AddComponent(component);
    }

    // Low level function that removes a component from the components array.
    function removeComponent(address component) external onlyModule onlyLocker {
        _components.quickRemoveItem(component);

        emit RemoveComponent(component);
    }

    /**
     * @dev Low level function that edits a component's virtual unit. Takes a real unit and converts it to virtual before committing.
     */
    function editDefaultPositionUnit(address component, int256 realUnit) external onlyModule onlyLocker {
        int256 virtualUnit = _convertRealToVirtualUnit(realUnit);
        _componentPositions[component].virtualUnit = virtualUnit;

        emit EditDefaultPositionUnit(component, realUnit);
    }

    /**
     * @dev Low level function that adds a module to a component's externalPositionModules array.
     */
    function addExternalPositionModule(address component, address positionModule) external onlyModule onlyLocker {
        require(!isExternalPositionModule(component, positionModule), "T1"); // "Module already added"

        _componentPositions[component].externalPositionModules.push(positionModule);

        emit AddPositionModule(component, positionModule);
    }

    /**
     * @dev Low level function that removes a module from a component's externalPositionModules array
     * and deletes the associated externalPosition.
     */
    function removeExternalPositionModule(address component, address positionModule) external onlyModule onlyLocker {
        _componentPositions[component].externalPositionModules.quickRemoveItem(positionModule);

        delete _componentPositions[component].externalPositions[positionModule];

        emit RemovePositionModule(component, positionModule);
    }

    /**
     * @dev Low level function that edits a component's external position virtual unit.
     * Takes a real unit and converts it to virtual before committing.
     */
    function editExternalPositionUnit(
        address component,
        address positionModule,
        int256 realUnit
    ) external onlyModule onlyLocker {
        int256 virtualUnit = _convertRealToVirtualUnit(realUnit);
        _componentPositions[component].externalPositions[positionModule].virtualUnit = virtualUnit;

        emit EditExternalPositionUnit(component, positionModule, realUnit);
    }

    /**
     * @dev Low level function that edits a component's external position data.
     */
    function editExternalPositionData(
        address component,
        address positionModule,
        bytes calldata data
    ) external onlyModule onlyLocker {
        _componentPositions[component].externalPositions[positionModule].data = data;

        emit EditExternalPositionData(component, positionModule, data);
    }

    /**
     * @dev Modifies the position multiplier. This is typically used to efficiently update all the
     * Positions' units at once in applications where inflation is awarded (e.g. subscription fees).
     */
    function editPositionMultiplier(int256 newMultiplier) external onlyModule onlyLocker {
        _validateNewMultiplier(newMultiplier);

        _positionMultiplier = newMultiplier;

        emit EditPositionMultiplier(newMultiplier);
    }

    /**
     * @dev Increases the `account` balance by the `quantity`.
     */
    function mint(address account, uint256 quantity) external onlyModule onlyLocker {
        _mint(account, quantity);
    }

    /**
     * @dev Decreases the `account` balance by the `quantity`.
     * _burn checks that the "account" already has the required "quantity".
     */
    function burn(address account, uint256 quantity) external onlyModule onlyLocker {
        _burn(account, quantity);
    }

    /**
     * @dev When locked, only the locker can call privileged functions.
     */
    function lock() external onlyModule {
        require(!_isLocked, "T2"); // "Must not be locked"
        _locker = msg.sender;
        _isLocked = true;
    }

    /**
     * @dev Unlocks the MatrixToken and clears the locker.
     */
    function unlock() external onlyModule {
        require(_isLocked, "T3a"); // "Must be locked"
        require(_locker == msg.sender, "T3b"); // "Must be locker"
        delete _locker;
        _isLocked = false;
    }

    /**
     * @dev Adds a module into a PENDING state; Module must later be initialized via module's initialize function
     */
    function addModule(address module) external onlyManager {
        _addModule(module);
    }

    function batchAddModule(address[] memory modules) external onlyManager {
        for (uint256 i = 0; i < modules.length; i++) {
            _addModule(modules[i]);
        }
    }

    /**
     * @dev Removes a module from the MatrixToken. MatrixToken calls removeModule on module itself
     * to confirm it is not needed to manage any remaining positions and to remove state.
     */
    function removeModule(address module) external onlyManager {
        _removeModule(module);
    }

    function batchRemoveModule(address[] memory modules) external onlyManager {
        for (uint256 i = 0; i < modules.length; i++) {
            _removeModule(modules[i]);
        }
    }

    /**
     * @dev Remove a pending module from the MatrixToken.
     */
    function removePendingModule(address module) external onlyManager {
        _removePendingModule(module);
    }

    function batchRemovePendingModule(address[] memory modules) external onlyManager {
        for (uint256 i = 0; i < modules.length; i++) {
            _removePendingModule(modules[i]);
        }
    }

    /**
     * @dev Initializes an added module from PENDING to INITIALIZED state. Can only call when unlocked.
     * An address can only enter a PENDING state if it is an enabled module added by the manager.
     * Only callable by the module itself, hence msg.sender is the subject of update.
     */
    function initializeModule() external {
        require(!_isLocked, "T4a"); // "Only when unlocked"
        require(_moduleStates[msg.sender] == IMatrixToken.ModuleState.PENDING, "T4b"); // "Module must be pending")

        _moduleStates[msg.sender] = IMatrixToken.ModuleState.INITIALIZED;
        _modules.push(msg.sender);

        emit InitializeModule(msg.sender);
    }

    /**
     * @dev Changes manager; Allow null addresses in case the manager wishes to wind down the MatrixToken.
     * Modules may rely on the manager state, so only changable when unlocked
     */
    function setManager(address newManager) external onlyManager {
        require(!_isLocked, "T5"); // "Only when unlocked"
        address oldManager = _manager;
        _manager = newManager;

        emit EditManager(newManager, oldManager);
    }

    // ==================== Public functions ====================

    function getDefaultPositionRealUnit(address component) public view returns (int256) {
        return _convertVirtualToRealUnit(_defaultPositionVirtualUnit(component));
    }

    function getExternalPositionRealUnit(address component, address positionModule) public view returns (int256) {
        return _convertVirtualToRealUnit(_externalPositionVirtualUnit(component, positionModule));
    }

    function isComponent(address component) public view returns (bool) {
        return _components.contain(component);
    }

    function isExternalPositionModule(address component, address module) public view returns (bool) {
        return _externalPositionModules(component).contain(module);
    }

    // ==================== Internal functions ====================

    function _addModule(address module) internal {
        require(_moduleStates[module] == IMatrixToken.ModuleState.NONE, "T6a"); // "Module must not be added"
        require(_controller.isModule(module), "T6b"); // "Must be enabled on Controller"

        _moduleStates[module] = IMatrixToken.ModuleState.PENDING;

        emit AddModule(module);
    }

    function _removeModule(address module) internal {
        require(!_isLocked, "T7a"); // // "Only when unlocked"
        require(_moduleStates[module] == IMatrixToken.ModuleState.INITIALIZED, "T7b"); // "Module must be added"

        IModule(module).removeModule();
        _moduleStates[module] = IMatrixToken.ModuleState.NONE;
        _modules.quickRemoveItem(module);

        emit RemoveModule(module);
    }

    function _removePendingModule(address module) internal {
        require(!_isLocked, "T8a"); // "Only when unlocked"
        require(_moduleStates[module] == IMatrixToken.ModuleState.PENDING, "T8b"); // "Module must be pending"

        _moduleStates[module] = IMatrixToken.ModuleState.NONE;

        emit RemovePendingModule(module);
    }

    function _defaultPositionVirtualUnit(address component) internal view returns (int256) {
        return _componentPositions[component].virtualUnit;
    }

    function _externalPositionModules(address component) internal view returns (address[] memory) {
        return _componentPositions[component].externalPositionModules;
    }

    function _externalPositionVirtualUnit(address component, address module) internal view returns (int256) {
        return _componentPositions[component].externalPositions[module].virtualUnit;
    }

    function _externalPositionData(address component, address module) internal view returns (bytes memory) {
        return _componentPositions[component].externalPositions[module].data;
    }

    /**
     * @dev Takes a real unit and divides by the position multiplier to return the virtual unit. Negative units
     * will be rounded away from 0 so no need to check that unit will be rounded down to 0 in conversion.
     */
    function _convertRealToVirtualUnit(int256 realUnit) internal view returns (int256) {
        int256 virtualUnit = realUnit.preciseDivFloor(_positionMultiplier);

        // This check ensures that the virtual unit does not return a result that has rounded down to 0
        if (realUnit > 0 && virtualUnit == 0) {
            revert("T9a"); // "Real to Virtual unit conversion invalid"
        }

        // This check ensures that when converting back to realUnits the unit won't be rounded down to 0
        if (realUnit > 0 && _convertVirtualToRealUnit(virtualUnit) == 0) {
            revert("T9b"); // "Virtual to Real unit conversion invalid"
        }

        return virtualUnit;
    }

    /**
     * @dev Takes a virtual unit and multiplies by the position multiplier to return the real unit
     */
    function _convertVirtualToRealUnit(int256 virtualUnit) internal view returns (int256) {
        return virtualUnit.preciseMulFloor(_positionMultiplier);
    }

    /**
     * @dev  To prevent virtual to real unit conversion issues (real unit may be 0), the product of the positionMultiplier
     * and the lowest absolute virtualUnit value (across default and external positions) must be greater than 0.
     */
    function _validateNewMultiplier(int256 newMultiplier) internal view {
        int256 minVirtualUnit = _getPositionsAbsMinimumVirtualUnit();

        require(minVirtualUnit.preciseMulFloor(newMultiplier) > 0, "T10"); // "New multiplier too small"
    }

    /**
     * @dev Loops through all of the positions and returns the smallest absolute value of the virtualUnit.
     */
    function _getPositionsAbsMinimumVirtualUnit() internal view returns (int256) {
        // Additional assignment happens in the loop below
        uint256 minimumUnit = type(uint256).max;

        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];

            // A default position exists if the default virtual unit is > 0
            uint256 defaultUnit = _defaultPositionVirtualUnit(component).toUint256();
            if (defaultUnit > 0 && defaultUnit < minimumUnit) {
                minimumUnit = defaultUnit;
            }

            address[] memory externalModules = _externalPositionModules(component);
            for (uint256 j = 0; j < externalModules.length; j++) {
                uint256 virtualUnit = SignedMath.abs(_externalPositionVirtualUnit(component, externalModules[j]));
                if ((virtualUnit > 0) && (virtualUnit < minimumUnit)) {
                    minimumUnit = virtualUnit;
                }
            }
        }

        return minimumUnit.toInt256();
    }

    /**
     * @dev Get the total number of positions, defined as the following:
     * - Each component has a default position if its virtual unit is > 0
     * - Each component's external positions module is counted as a position
     */
    function _getPositionCount() internal view returns (uint256) {
        uint256 positionCount;
        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];

            // Increment the position count if the default position is > 0
            if (_defaultPositionVirtualUnit(component) > 0) {
                positionCount++;
            }

            // Increment the position count by each external position module
            address[] memory externalModules = _externalPositionModules(component);
            if (externalModules.length > 0) {
                positionCount += externalModules.length;
            }
        }

        return positionCount;
    }

    // ==================== Private functions ====================

    function _onlyModule() private view {
        require(_moduleStates[msg.sender] == IMatrixToken.ModuleState.INITIALIZED, "T11a"); // "Only the module can call"
        require(_controller.isModule(msg.sender), "T11b"); // "Module must be enabled on controller"
    }

    function _onlyManager() private view {
        require(msg.sender == _manager, "T12"); // "Only manager can call")
    }

    function _onlyLocker() private view {
        require(!_isLocked || (msg.sender == _locker), "T13"); // "When locked, only the locker can call")
    }
}
