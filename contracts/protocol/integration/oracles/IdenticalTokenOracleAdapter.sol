// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { AccessControlEnumerable } from "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

// ==================== Internal Imports ====================

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { AddressArrayUtil } from "../../../lib/AddressArrayUtil.sol";

import { IPriceOracle } from "../../../interfaces/IPriceOracle.sol";
import { IOracleAdapter } from "../../../interfaces/IOracleAdapter.sol";

/**
 * @title IdenticalTokenOracleAdapter
 * @author Matrix
 *
 * @dev IdenticalTokenOracleAdapter returns token's price which is identical with other token
 */
contract IdenticalTokenOracleAdapter is AccessControlEnumerable, IOracleAdapter {
    using PreciseUnitMath for uint256;
    using AddressArrayUtil for address[];

    // ==================== Constants ====================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== Variables ====================

    IPriceOracle internal immutable _priceOracle;

    address[] internal _reserveTokens;

    // reserve tokens token => underlying token
    mapping(address => address) internal _underlyingTokens;

    // ==================== Constructor function ====================

    /**
     * @param priceOracle    Instance of PriceOracle contract
     */
    constructor(IPriceOracle priceOracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        _priceOracle = priceOracle;
    }

    // ==================== Modifier functions ====================

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    // ==================== External functions ====================

    function getPriceOracle() external view returns (IPriceOracle) {
        return _priceOracle;
    }

    function getReserveTokens() external view returns (address[] memory) {
        return _reserveTokens;
    }

    function getReserveToken(uint256 index) external view returns (address) {
        return _reserveTokens[index];
    }

    /**
     * @dev PriceOracle ensures asset1 and asset2 are not zero addresses before call this function
     */
    function getPrice(address asset1, address asset2) external view returns (bool found, uint256 price) {
        address underlyingToken1 = getUnderlyingToken(asset1);
        address underlyingToken2 = getUnderlyingToken(asset2);

        if (asset1 == underlyingToken2 || underlyingToken1 == asset2) {
            return (true, 10**18);
        }

        if (underlyingToken1 != address(0)) {
            try _priceOracle.getPrice(underlyingToken1, asset2) returns (uint256 price_) {
                return (true, price_);
            } catch {}
        }

        if (underlyingToken2 != address(0)) {
            try _priceOracle.getPrice(asset1, underlyingToken2) returns (uint256 price_) {
                return (true, price_);
            } catch {}
        }
    }

    function addPair(address reserveToken, address underlyingToken) external onlyAdmin {
        _addPair(reserveToken, underlyingToken);
    }

    function addPairs(address[] calldata reserveTokens, address[] calldata underlyingTokens) external onlyAdmin {
        require(reserveTokens.length == underlyingTokens.length, "IOA0");

        for (uint256 i = 0; i < reserveTokens.length; i++) {
            _addPair(reserveTokens[i], underlyingTokens[i]);
        }
    }

    function removePair(address reserveToken, address underlyingToken) external onlyAdmin {
        _removePair(reserveToken, underlyingToken);
    }

    function removePairs(address[] calldata reserveTokens, address[] calldata underlyingTokens) external onlyAdmin {
        require(reserveTokens.length == underlyingTokens.length, "IOA1");

        for (uint256 i = 0; i < reserveTokens.length; i++) {
            _removePair(reserveTokens[i], underlyingTokens[i]);
        }
    }

    // ==================== Public functions ====================

    function getUnderlyingToken(address reserveToken) public view returns (address) {
        return _underlyingTokens[reserveToken];
    }

    // ==================== Internal functions ====================

    function _addPair(address reserveToken, address underlyingToken) internal {
        require(reserveToken != address(0), "IOA2a");
        require(underlyingToken != address(0), "IOA2b");
        require(getUnderlyingToken(reserveToken) == address(0), "IOA2c"); // "reserveToken is already exist"
        require(getUnderlyingToken(underlyingToken) != reserveToken, "IOA2d"); // Prevent infinite loops when call getPrice

        _reserveTokens.push(reserveToken);
        _underlyingTokens[reserveToken] = underlyingToken;
    }

    function _removePair(address reserveToken, address underlyingToken) internal {
        require(reserveToken != address(0), "IOA3a");
        require(getUnderlyingToken(reserveToken) == underlyingToken, "IOA3b");

        _reserveTokens.quickRemoveItem(reserveToken);
        delete _underlyingTokens[reserveToken];
    }

    // ==================== Private functions ====================

    function _onlyAdmin() private view {
        require(hasRole(ADMIN_ROLE, _msgSender()), "IOA4");
    }
}
