// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

function ethToWei(quantity) {
  return ethers.utils.parseEther(`${quantity}`);
}

function weiToEth(quantity) {
  return parseFloat(ethers.utils.formatEther(`${quantity}`));
}

function usdToWei(quantity) {
  return ethers.utils.parseUnits(`${quantity}`, 6); // USDC, USDT
}

function btcToWei(quantity) {
  return ethers.utils.parseUnits(`${quantity}`, 8);
}

module.exports = {
  ethToWei,
  weiToEth,
  usdToWei,
  btcToWei,
};
