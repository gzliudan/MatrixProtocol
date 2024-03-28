// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

function hashAdapterName(name) {
  return ethers.utils.id(name);
}

function addressToData(addr) {
  return addr.replace('0x', '000000000000000000000000');
}

function bigNumberToData(number) {
  return number.toHexString().replace('0x', '').padStart(64, '0');
}

module.exports = {
  addressToData,
  bigNumberToData,
  hashAdapterName,
};
