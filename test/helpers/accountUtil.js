// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers, waffle } = require('hardhat');
const { provider } = waffle;

function getSigners() {
  return provider.getWallets();
}

function getLastSigner() {
  const accounts = getSigners();
  return accounts[accounts.length - 1];
}

// NOTE: no ETH in random account
function getRandomAccount() {
  return ethers.Wallet.createRandom().connect(provider);
}

function getRandomAddress() {
  return getRandomAccount().getAddress();
}

async function getEthBalance(account) {
  return await provider.getBalance(account);
}

async function setEthBalance(account, balance) {
  await provider.send('hardhat_setBalance', [account, balance]);
}

module.exports = {
  getSigners,
  getLastSigner,
  getRandomAccount,
  getRandomAddress,
  getEthBalance,
  setEthBalance,
};
