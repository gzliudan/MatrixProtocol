// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

const hashAdapterName = (name) => ethers.utils.id(name);
const addressToData = (addr) => addr.replace('0x', '000000000000000000000000');
const bigNumberToData = (number) => number.toHexString().replace('0x', '').padStart(64, '0');

module.exports = {
  addressToData,
  bigNumberToData,
  hashAdapterName,
};
