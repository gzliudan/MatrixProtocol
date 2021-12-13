// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { provider } = require('hardhat').waffle;

const snapshotBlockchain = async () => await provider.send('evm_snapshot', []);
const revertBlockchain = async (snapshotId) => await provider.send('evm_revert', [snapshotId]);

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
