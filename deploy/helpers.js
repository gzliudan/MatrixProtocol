// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const fs = require('fs');
const dayjs = require('dayjs');

const DIR = './deploy/deployed-contracts';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEthers(hre) {
  if (!hre?.ethers) {
    hre = require('hardhat');
  }

  return hre.ethers;
}

function getDeployer(RPC_ENDPOINT, DEPLOYER_PRIVATE_KEY, hre) {
  const ethers = getEthers(hre);
  const provider = new ethers.providers.JsonRpcProvider(RPC_ENDPOINT);
  const deployer = new ethers.Wallet(`0x${DEPLOYER_PRIVATE_KEY}`, provider);
  return deployer;
}

async function deployContract(signer, name, args = []) {
  // https://github.com/NomicFoundation/hardhat/blob/master/packages/hardhat-ethers/README.md#helpers
  const { ethers } = require('hardhat');
  const Implementation = await ethers.getContractFactory(name, signer);
  const contract = await Implementation.deploy(...args);
  return contract.deployed();
}

async function deployContractAndLinkLibraries(signer, name, args = [], libraries = {}) {
  // https://github.com/NomicFoundation/hardhat/blob/master/packages/hardhat-ethers/README.md#helpers
  const { ethers } = require('hardhat');
  const Implementation = await ethers.getContractFactory(name, { signer, libraries });
  const contract = await Implementation.deploy(...args);
  return contract.deployed();
}

function getDeployedAddresses(chain_name, chain_id) {
  const filename = `${DIR}/${chain_name}.json`;

  let contractAddresses;

  try {
    contractAddresses = JSON.parse(fs.readFileSync(filename));
  } catch (e) {
    console.error(e);
    contractAddresses = {
      chain_name,
      chain_id,
    };
  }

  return { directory: DIR, filename, contractAddresses };
}

function writeDeployedAddresses(directory, filename, addresses) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(addresses, null, 4));
}

function getWeth(config, CHAIN_NAME) {
  let weth;

  if (CHAIN_NAME == 'mumbai' || CHAIN_NAME == 'polygon') {
    weth = config['tokens']['wmatic'];

    if (!weth) {
      throw new Error(`Must set "tokens"."wmatic" in config file !`);
    }
  } else {
    weth = config['tokens']['weth'];

    if (!weth) {
      throw new Error(`Must set "tokens"."weth" in config file !`);
    }
  }

  return weth;
}

function joinByFlags(flags, names) {
  if (flags.length != names.length) {
    throw new Error(`joinByFlags: length mismatch !`);
  }

  let result = '';

  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) {
      result += result ? `, ${names[i]}` : names[i];
    }
  }

  return result;
}

function getDataTime() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

module.exports = {
  sleep,
  getDeployer,
  deployContract,
  deployContractAndLinkLibraries,
  getDeployedAddresses,
  writeDeployedAddresses,
  getWeth,
  joinByFlags,
  getDataTime,
};
