// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../lib/AddressArrayUtil.sol";

import { IOracle } from "../interfaces/IOracle.sol";
import { IController } from "../interfaces/IController.sol";
import { IPriceOracle } from "../interfaces/IPriceOracle.sol";
import { IOracleAdapter } from "../interfaces/IOracleAdapter.sol";

/**
 * @title PriceOracle
 *
 * @notice Prices are 18 decimals of precision
 */
contract PriceOracle is AccessControl, IPriceOracle {
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Variables ====================

    IController internal immutable _controller;

    mapping(address => mapping(address => IOracle)) internal _oracles;

    address internal _masterQuoteAsset;
    address internal _secondQuoteAsset;

    address[] internal _adapters;

    // ==================== Constructor function ====================

    constructor(
        IController controller,
        address masterQuoteAsset,
        address[] memory adapters,
        address[] memory assets1,
        address[] memory assets2,
        IOracle[] memory oracles
    ) {
        require(assets1.length == assets2.length, "PO0a"); // "Array lengths do not match"
        require(assets1.length == oracles.length, "PO0b"); // "Array lengths do not match"

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _controller = controller;
        _masterQuoteAsset = masterQuoteAsset;
        _adapters = adapters;

        for (uint256 i = 0; i < assets1.length; i++) {
            _oracles[assets1[i]][assets2[i]] = oracles[i];
        }
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

    function getOracle(address asset1, address asset2) external view returns (address) {
        return address(_oracles[asset1][asset2]);
    }

    function getMasterQuoteAsset() external view returns (address) {
        return _masterQuoteAsset;
    }

    function getSecondQuoteAsset() external view returns (address) {
        return _secondQuoteAsset;
    }

    function getAdapters() external view returns (address[] memory) {
        return _adapters;
    }

    function getPrice(address asset1, address asset2) external view returns (uint256) {
        require(asset1 != address(0), "PO1a");
        require(asset2 != address(0), "PO1b");

        if (asset1 == asset2) {
            return 10**18;
        }

        (bool found, uint256 price) = _getDirectOrInversePrice(asset1, asset2);
        if (found) {
            return price;
        }

        address masterAsset = _masterQuoteAsset; // save gas
        if (masterAsset != address(0)) {
            (found, price) = _getPriceFromQuoteAsset(asset1, asset2, masterAsset);
            if (found) {
                return price;
            }
        }

        address secondAsset = _secondQuoteAsset; // save gas
        if ((secondAsset != address(0)) && (secondAsset != masterAsset)) {
            (found, price) = _getPriceFromQuoteAsset(asset1, asset2, secondAsset);
            if (found) {
                return price;
            }
        }

        (found, price) = _getPriceFromAdapters(asset1, asset2);
        if (found) {
            return price;
        }

        revert("PO1c"); // "Price not found"
    }

    function addPair(
        address asset1,
        address asset2,
        address oracle
    ) external onlyAdmin {
        require(address(_oracles[asset1][asset2]) == address(0), "PO2"); // "Pair already exists"

        _oracles[asset1][asset2] = IOracle(oracle);

        emit AddPair(asset1, asset2, oracle);
    }

    function editPair(
        address asset1,
        address asset2,
        address oracle
    ) external onlyAdmin {
        require(address(_oracles[asset1][asset2]) != address(0), "PO3"); // "Pair doesn't exist"

        _oracles[asset1][asset2] = IOracle(oracle);

        emit EditPair(asset1, asset2, oracle);
    }

    function removePair(address asset1, address asset2) external onlyAdmin {
        address oldOracle = address(_oracles[asset1][asset2]);
        require(oldOracle != address(0), "PO4"); // "Pair doesn't exist"

        delete _oracles[asset1][asset2];

        emit RemovePair(asset1, asset2, oldOracle);
    }

    function addAdapter(address adapter) external onlyAdmin {
        require(!_adapters.contain(adapter), "PO5"); // "Adapter already exists"

        _adapters.push(adapter);

        emit AddAdapter(adapter);
    }

    function removeAdapter(address adapter) external onlyAdmin {
        require(_adapters.contain(adapter), "PO6"); // "Adapter does not exist"

        _adapters.quickRemoveItem(adapter);

        emit RemoveAdapter(adapter);
    }

    function editMasterQuoteAsset(address newMasterQuoteAsset) external onlyAdmin {
        _masterQuoteAsset = newMasterQuoteAsset;

        emit EditMasterQuoteAsset(newMasterQuoteAsset);
    }

    function editSecondQuoteAsset(address newSecondQuoteAsset) external onlyAdmin {
        _secondQuoteAsset = newSecondQuoteAsset;

        emit EditSecondQuoteAsset(newSecondQuoteAsset);
    }

    // ==================== Internal functions ====================

    function _getDirectOrInversePrice(address asset1, address asset2) internal view returns (bool found, uint256 price) {
        IOracle oracle = _oracles[asset1][asset2];

        if (address(oracle) != address(0)) {
            // If exists (asset1 -> asset2) then return value
            found = true;
            price = oracle.read();
        } else {
            oracle = _oracles[asset2][asset1];

            if (address(oracle) != address(0)) {
                // If exists (asset2 -> asset1) then return (1 / value)
                found = true;
                price = _calculateInversePrice(oracle);
            }
        }
    }

    function _getPriceFromQuoteAsset(
        address asset1,
        address asset2,
        address quoteAsset
    ) internal view returns (bool, uint256) {
        (bool found1, uint256 price1) = _getDirectOrInversePrice(asset1, quoteAsset);

        if (found1) {
            (bool found2, uint256 price2) = _getDirectOrInversePrice(asset2, quoteAsset);

            if (found2) {
                return (true, price1.preciseDiv(price2));
            }
        }

        return (false, 0);
    }

    function _getPriceFromAdapters(address asset1, address asset2) internal view returns (bool found, uint256 price) {
        for (uint256 i = 0; i < _adapters.length; i++) {
            (found, price) = IOracleAdapter(_adapters[i]).getPrice(asset1, asset2);

            if (found) {
                break;
            }
        }
    }

    function _calculateInversePrice(IOracle inverseOracle) internal view returns (uint256) {
        uint256 inverseValue = inverseOracle.read();

        return PreciseUnitMath.preciseUnit().preciseDiv(inverseValue);
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "PO7");
    }
}
