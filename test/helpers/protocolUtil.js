// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers, waffle } = require('hardhat');
const { provider } = waffle;

// ==================== Internal Imports ====================

const { ZERO_ADDRESS, EMPTY_BYTES } = require('./constants');

async function getCreatedMatrixTokenAddress(txnHash) {
  if (!txnHash) {
    throw new Error('Invalid transaction hash');
  }

  const topic = ethers.utils.id('CreateMatrixToken(address,address,string,string)');
  const logs = await provider.getLogs({
    fromBlock: 'latest',
    toBlock: 'latest',
    topics: [topic],
  });

  const abi = ['event CreateMatrixToken(address indexed matrixToken, address indexed manager, string name, string symbol)'];
  const interface = new ethers.utils.Interface(abi);
  const lastLog = interface.parseLog(logs[logs.length - 1]);

  return lastLog.args.matrixToken;
}

const getDefaultPosition = (component, unit) => ({
  unit,
  module: ZERO_ADDRESS,
  component,
  positionState: 0,
  data: EMPTY_BYTES,
});

const getExternalPosition = (component, module, unit, data) => ({
  unit,
  module,
  component,
  positionState: 1,
  data,
});

module.exports = {
  getCreatedMatrixTokenAddress,
  getDefaultPosition,
  getExternalPosition,
};
