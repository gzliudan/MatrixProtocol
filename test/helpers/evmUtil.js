// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { provider } = require('hardhat').waffle;

async function snapshotBlockchain() {
  return await provider.send('evm_snapshot', []);
}

async function revertBlockchain(snapshotId) {
  await provider.send('evm_revert', [snapshotId]);
}

async function increaseBlockTime(seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine');
}

async function getLastBlockTimestamp() {
  return (await provider.getBlock('latest')).timestamp;
}

module.exports = {
  snapshotBlockchain,
  revertBlockchain,
  increaseBlockTime,
  getLastBlockTimestamp,
};
