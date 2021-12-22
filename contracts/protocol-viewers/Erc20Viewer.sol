// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

// ==================== External Imports ====================

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Erc20Viewer
 *
 * @dev fetching multiple ERC20 state in a single read
 */
contract Erc20Viewer {
    // ==================== External functions ====================

    /**
     * @dev Fetches token balances for each tokenAddress, tokenOwner pair
     *
     * @param tokens       Addresses of ERC20 contracts
     * @param owners       Addresses of users sequential to tokenAddress
     *
     * @return balances    Array of balances for each ERC20 contract passed in
     */
    function batchFetchBalancesOf(address[] calldata tokens, address[] calldata owners) public view returns (uint256[] memory balances) {
        balances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = ERC20(address(tokens[i])).balanceOf(owners[i]);
        }
    }

    /**
     * @dev Fetches token allowances for each tokenAddress, tokenOwner tuple
     *
     * @param tokens         Addresses of ERC20 contracts
     * @param owners         Addresses of owner sequential to tokenAddress
     * @param spenders       Addresses of spenders sequential to tokenAddress
     *
     * @return allowances    Array of allowances for each ERC20 contract passed in
     */
    function batchFetchAllowances(
        address[] calldata tokens,
        address[] calldata owners,
        address[] calldata spenders
    ) public view returns (uint256[] memory allowances) {
        allowances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            allowances[i] = ERC20(address(tokens[i])).allowance(owners[i], spenders[i]);
        }
    }

    function batchFetchInfo(
        address owner,
        address spender,
        address[] calldata tokens
    )
        public
        view
        returns (
            string[] memory names,
            string[] memory symbols,
            uint8[] memory decimals,
            uint256[] memory balances,
            uint256[] memory allowances
        )
    {
        if (owner == address(0)) {
            owner = msg.sender;
        }

        names = new string[](tokens.length);
        symbols = new string[](tokens.length);
        decimals = new uint8[](tokens.length);
        balances = new uint256[](tokens.length);
        allowances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20 token = ERC20(address(tokens[i]));

            names[i] = token.name();
            symbols[i] = token.symbol();
            decimals[i] = token.decimals();
            balances[i] = token.balanceOf(owner);
            allowances[i] = (spender != address(0)) ? token.allowance(owner, spender) : 0;
        }
    }
}
