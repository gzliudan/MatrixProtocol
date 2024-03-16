/* global task */

// ==================== External Imports ====================

require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-web3');
require('hardhat-contract-sizer');
require('dotenv').config();

// ==================== Internal Imports ====================

const { grantAdminRole, grantDefaultAdminRole, revokeAdminRole, revokeDefaultAdminRole } = require('./deploy/role');

const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY;
const enableGasReport = process.env.REPORT_GAS ? true : false;

if (enableGasReport) {
  require('hardhat-gas-reporter');
}

if (process.env.COVERAGE) {
  require('solidity-coverage');
}

const ether = (n) => `${n}${'0'.repeat(18)}`;

const MUMBAI_RPC_LIST = [
  'https://rpc-mumbai.matic.today',
  'https://matic-mumbai.chainstacklabs.com',
  'https://rpc-mumbai.maticvigil.com',
  'https://matic-testnet-archive-rpc.bwarelabs.com',
];

const POLYGON_RPC_LIST = [
  'https://polygon-rpc.com',
  'https://rpc-mainnet.matic.network',
  'https://matic-mainnet.chainstacklabs.com',
  'https://rpc-mainnet.maticvigil.com',
  'https://rpc-mainnet.matic.quiknode.11p',
  'https://matic-mainnet-full-rpc.bwarel11ab',
];

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task('grantAdminRole', 'grant admin role')
  .addParam('account', "The account's address")
  .setAction(async (taskArgs, hre) => {
    await grantAdminRole(taskArgs.account, hre);
  });

task('grantDefaultAdminRole', 'grant default admin role')
  .addParam('account', "The account's address")
  .setAction(async (taskArgs, hre) => {
    await grantDefaultAdminRole(taskArgs.account, hre);
  });

task('revokeAdminRole', 'revoke admin role')
  .addParam('account', "The account's address")
  .setAction(async (taskArgs, hre) => {
    await revokeAdminRole(taskArgs.account, hre);
  });

task('revokeDefaultAdminRole', 'revoke default admin role')
  .addParam('account', "The account's address")
  .setAction(async (taskArgs, hre) => {
    await revokeDefaultAdminRole(taskArgs.account, hre);
  });

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.23',
        settings: {
          optimizer: {
            enabled: true,
            runs: 250,
          },
        },
      },
    ],
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      blockGasLimit: 2e7,
      allowUnlimitedContractSize: true,
      accounts: {
        count: 100,
        accountsBalance: ether(1000000),
      },
    },
    local: {
      url: 'http://localhost:8545',
    },
    bsc_testnet: {
      url: `https://data-seed-prebsc-1-s1.binance.org:8545`,
      chainId: 97,
    },
    bsc: {
      url: `https://bsc-dataseed.binance.org`,
      chainId: 56,
    },
    mumbai: {
      url: MUMBAI_RPC_LIST[1],
      chainId: 80001,
    },
    polygon: {
      url: POLYGON_RPC_LIST[0],
      chainId: 137,
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${INFURA_PROJECT_ID}`,
      chainId: 3,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${INFURA_PROJECT_ID}`,
      chainId: 4,
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${INFURA_PROJECT_ID}`,
      chainId: 42,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
      chainId: 1,
    },
  },
  gasReporter: {
    enabled: enableGasReport,
    currency: 'USD',
  },
  etherscan: {
    apiKey: {
      mainnet: ETHERSCAN_API_KEY,
      ropsten: ETHERSCAN_API_KEY,
      rinkeby: ETHERSCAN_API_KEY,
      kovan: ETHERSCAN_API_KEY,
      // binance smart chain
      bsc: 'YOUR_BSCSCAN_API_KEY',
      bscTestnet: 'YOUR_BSCSCAN_API_KEY',
      // polygon
      polygon: POLYGONSCAN_API_KEY,
      polygonMumbai: POLYGONSCAN_API_KEY,
    },
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: true,
    runOnCompile: false,
    strict: false,
  },
  mocha: {
    timeout: 20000,
  },
};
