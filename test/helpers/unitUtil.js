// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

const ethToWei = (quantity) => ethers.utils.parseEther(`${quantity}`);
const weiToEth = (quantity) => parseFloat(ethers.utils.formatEther(`${quantity}`));

const usdToWei = (quantity) => ethers.utils.parseUnits(`${quantity}`, 6); // USDC, USDT
const btcToWei = (quantity) => ethers.utils.parseUnits(`${quantity}`, 8);

module.exports = {
  ethToWei,
  weiToEth,
  usdToWei,
  btcToWei,
};
