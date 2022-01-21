// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title Erc20ErrorMock
 */
contract Erc20ErrorMock is IERC20 {
    using SafeCast for int256;

    // ==================== Variables ====================

    uint8 internal constant _decimals = 18;
    string internal _name;
    string internal _symbol;
    int256 internal _err;

    mapping(address => uint256) internal _balances;

    mapping(address => mapping(address => uint256)) internal _allowed;

    uint256 internal _totalSupply;

    // ==================== Constructor function ====================

    constructor(
        address initialAccount,
        uint256 initialBalance,
        int256 err,
        string memory name_,
        string memory symbol_,
        uint8 /* decimals */
    ) {
        _balances[initialAccount] = initialBalance;
        _totalSupply = initialBalance;
        _name = name_;
        _symbol = symbol_;
        _err = err;
    }

    // ==================== External functions ====================

    function name() public view virtual returns (string memory) {
        return _name;
    }

    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev Returns balance of owner with the rounding error applied
     * @param owner address whose balance is to be returned
     */
    function balanceOf(address owner) public view virtual override returns (uint256) {
        uint256 balance = _balances[owner];

        if (_err >= 0) {
            return balance + _err.toUint256();
        } else {
            uint256 absoluteError = (-_err).toUint256();
            return (balance >= absoluteError) ? (balance - absoluteError) : 0;
        }
    }

    /**
     * @dev Transfer tokens from one address to another
     * @param from     address The address which you want to send tokens from
     * @param to       address The address which you want to transfer to
     * @param value    uint256 the amount of tokens to be transferred
     */
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool) {
        require(to != address(0), "to null");
        require(value <= _balances[from], "value greater than from balance");
        require(value <= _allowed[from][msg.sender], "value greater than allowed");

        _balances[from] -= value;
        _balances[to] += value;
        _allowed[from][msg.sender] -= value;

        emit Transfer(from, to, value);

        return true;
    }

    /**
     * @dev Transfer tokens from one address to another
     * @param to       The address to transfer to.
     * @param value    The amount to be transferred.
     */
    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "to null");
        require(value <= _balances[msg.sender], "value greater than sender balance");

        _balances[msg.sender] -= value;
        _balances[to] += value;

        emit Transfer(msg.sender, to, value);

        return true;
    }

    function setError(int256 err) external returns (bool) {
        _err = err;

        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowed[owner][spender];
    }

    function approve(address spender, uint256 value) external returns (bool) {
        require(spender != address(0));

        _allowed[msg.sender][spender] = value;

        emit Approval(msg.sender, spender, value);

        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        require(spender != address(0));

        _allowed[msg.sender][spender] += addedValue;

        emit Approval(msg.sender, spender, _allowed[msg.sender][spender]);

        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        require(spender != address(0));

        _allowed[msg.sender][spender] -= subtractedValue;

        emit Approval(msg.sender, spender, _allowed[msg.sender][spender]);

        return true;
    }
}
