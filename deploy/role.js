// SPDX-License-Identifier: Apache-2.0

// ==================== Internal Imports ====================

const adminContracts = require('./configs/adminContracts.json');
const { sleep, getDeployer, getDeployedAddresses } = require('./helpers');

const ADMIN_ROLE = '0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775';
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

async function grantRole(task, instance, roleName, account) {
  console.log(`TASK: ${task}`);
  if (!(await instance.hasRole(roleName, account))) {
    console.log(`DO  : ${task}`);
    await instance.grantRole(roleName, account);

    let done = false;
    for (let i = 0; i < 30; i++) {
      if (await instance.hasRole(roleName, account)) {
        done = true;
        console.log(`OK  : ${task}\n`);
        break;
      } else {
        await sleep(1000);
      }
    }

    if (!done) {
      throw new Error(`FAIL: ${task}`);
    }
  } else {
    console.log(`SKIP: ${task}\n`);
  }
}

function getDeployerAndContracts(hre) {
  const CHAIN_NAME = hre.network.name;
  const CHAIN_ID = hre.network.config.chainId;
  const RPC_ENDPOINT = hre.network.config.url;
  console.log(`\nCHAIN_NAME = ${CHAIN_NAME}, CHAIN_ID = ${CHAIN_ID}, RPC_ENDPOINT = ${RPC_ENDPOINT}\n`);

  const { DEPLOYER_PRIVATE_KEY } = process.env;
  if (!DEPLOYER_PRIVATE_KEY) {
    throw new Error(`Must set DEPLOYER_PRIVATE_KEY in file .env !`);
  }

  const deployer = getDeployer(RPC_ENDPOINT, DEPLOYER_PRIVATE_KEY, hre);
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);

  return { deployer, filename, contractAddresses };
}

async function grantAdminRole(account, hre) {
  const { deployer, filename, contractAddresses } = getDeployerAndContracts(hre);

  for (const contract of adminContracts) {
    const { name, key } = contract;

    const { [key]: contractAddress } = contractAddresses;
    if (!contractAddress) {
      throw new Error(`must set ${key} in ${filename} !`);
    }

    const implementation = await hre.ethers.getContractFactory(name, deployer);
    const instance = await implementation.attach(contractAddress);

    const task = `${name} grant ADMIN_ROLE to ${account}`;
    await grantRole(task, instance, ADMIN_ROLE, account);
  }
}

async function grantDefaultAdminRole(account, hre) {
  const { deployer, filename, contractAddresses } = getDeployerAndContracts(hre);

  for (const contract of adminContracts) {
    const { name, key } = contract;

    const { [key]: contractAddress } = contractAddresses;
    if (!contractAddress) {
      throw new Error(`must set ${key} in ${filename} !`);
    }

    const implementation = await hre.ethers.getContractFactory(name, deployer);
    const instance = await implementation.attach(contractAddress);

    const task = `${name} grant DEFAULT_ADMIN_ROLE to ${account}`;
    await grantRole(task, instance, DEFAULT_ADMIN_ROLE, account);
  }
}

async function revokeRole(task, instance, roleName, account) {
  console.log(`TASK: ${task}`);
  if (await instance.hasRole(roleName, account)) {
    console.log(`DO  : ${task}`);
    await instance.revokeRole(roleName, account);

    let done = false;
    for (let i = 0; i < 30; i++) {
      if (!(await instance.hasRole(roleName, account))) {
        done = true;
        console.log(`OK  : ${task}\n`);
        break;
      } else {
        await sleep(1000);
      }
    }

    if (!done) {
      throw new Error(`FAIL: ${task}`);
    }
  } else {
    console.log(`SKIP: ${task}\n`);
  }
}

async function revokeAdminRole(account, hre) {
  const { deployer, filename, contractAddresses } = getDeployerAndContracts(hre);

  for (const contract of adminContracts) {
    const { name, key } = contract;

    const { [key]: contractAddress } = contractAddresses;
    if (!contractAddress) {
      throw new Error(`must set ${key} in ${filename} !`);
    }

    const implementation = await hre.ethers.getContractFactory(name, deployer);
    const instance = await implementation.attach(contractAddress);

    const task = `${name} revoke ${account} from ADMIN_ROLE`;
    await revokeRole(task, instance, ADMIN_ROLE, account);
  }
}

async function revokeDefaultAdminRole(account, hre) {
  const { deployer, filename, contractAddresses } = getDeployerAndContracts(hre);

  for (const contract of adminContracts) {
    const { name, key } = contract;

    const { [key]: contractAddress } = contractAddresses;
    if (!contractAddress) {
      throw new Error(`must set ${key} in ${filename} !`);
    }

    const implementation = await hre.ethers.getContractFactory(name, deployer);
    const instance = await implementation.attach(contractAddress);

    const task = `${name} revoke ${account} from DEFAULT_ADMIN_ROLE`;
    await revokeRole(task, instance, DEFAULT_ADMIN_ROLE, account);
  }
}

module.exports = {
  grantAdminRole,
  grantDefaultAdminRole,
  revokeAdminRole,
  revokeDefaultAdminRole,
};
