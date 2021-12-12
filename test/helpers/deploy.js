// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

async function deployContract(name, args = [], signer) {
  const Implementation = await ethers.getContractFactory(name, signer?.address ? { signer } : {});
  const contract = await Implementation.deploy(...args);
  return contract.deployed();
}

async function deployContractAndLinkLibraries(name, args = [], libraries = {}, signer) {
  const Implementation = await ethers.getContractFactory(name, signer?.address ? { signer, libraries } : { libraries });
  const contract = await Implementation.deploy(...args);
  return contract.deployed();
}

module.exports = {
  deployContract,
  deployContractAndLinkLibraries,
};
