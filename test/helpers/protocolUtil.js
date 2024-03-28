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

  const topic = ethers.utils.id('CreateMatrixToken(address,address,address[],int256[],address[],address,address,string,string)');
  const logs = await provider.getLogs({
    fromBlock: 'latest',
    toBlock: 'latest',
    topics: [topic],
  });

  const abi = [
    'event CreateMatrixToken(address indexed creater, address indexed matrixToken, address[] components, int256[] units, address[] modules, address controller, address indexed manager, string name, string symbol)',
  ];

  const interface = new ethers.utils.Interface(abi);
  const lastLog = interface.parseLog(logs[logs.length - 1]);

  return lastLog.args.matrixToken;
}

function getDefaultPosition(component, unit) {
  return {
    unit,
    module: ZERO_ADDRESS,
    component,
    positionState: 0,
    data: EMPTY_BYTES,
  };
}

function getExternalPosition(component, module, unit, data) {
  return {
    unit,
    module,
    component,
    positionState: 1,
    data,
  };
}

module.exports = {
  getCreatedMatrixTokenAddress,
  getDefaultPosition,
  getExternalPosition,
};
