// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers, waffle } = require('hardhat');
const { provider } = waffle;

const getSigners = () => provider.getWallets();

const getLastSigner = () => {
  const accounts = getSigners();
  return accounts[accounts.length - 1];
};

// NOTE: no ETH in random account
const getRandomAccount = () => ethers.Wallet.createRandom().connect(provider);

const getRandomAddress = () => getRandomAccount().getAddress();

const getEthBalance = async (account) => await provider.getBalance(account);
const setEthBalance = async (account, balance) => await provider.send('hardhat_setBalance', [account, balance]);

module.exports = {
  getSigners,
  getLastSigner,
  getRandomAccount,
  getRandomAddress,
  getEthBalance,
  setEthBalance,
};
