// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Erc20WithFeeMock
 * @author Matrix
 */
contract Erc20WithFeeMock is ERC20 {
    // ==================== Variables ====================

    uint256 public immutable _feePercentage;

    // ==================== Constructor function ====================

    constructor(
        string memory name,
        string memory symbol,
        uint256 feePercentage
    ) ERC20(name, symbol) {
        require(feePercentage <= 100, "RebaseErc20Mock: feePercentage >= 100");
        _feePercentage = feePercentage;
    }

    // ==================== External functions ====================

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        uint256 amountOfSend = (amount * (100 - _feePercentage)) / 100;
        uint256 amountOfFee = amount - amountOfSend;

        _transfer(_msgSender(), address(this), amountOfFee);
        _transfer(_msgSender(), recipient, amountOfSend);

        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        uint256 amountOfSend = (amount * (100 - _feePercentage)) / 100;
        uint256 amountOfFee = amount - amountOfSend;

        _transfer(sender, address(this), amountOfFee);
        super.transferFrom(sender, recipient, amountOfSend);

        return true;
    }
}
