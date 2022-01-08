// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const fs = require('fs');
const hre = require('hardhat');

// ==================== Internal Imports ====================

const { WEI_PER_ETHER } = require('./constants');
const oracles = require('./configs/oracles.json');
const testTokens = require('./configs/testTokens.json');
const { getWeth, getDeployedAddresses, getDataTime } = require('./helpers');

const CHAIN_NAME = hre.network.name;
const CHAIN_ID = hre.network.config.chainId;
console.log(`\nCHAIN_NAME = ${CHAIN_NAME}, CHAIN_ID = ${CHAIN_ID}\n`);

// load config
const CONFIG_FILE = `./deploy/configs/${CHAIN_NAME}.json`;
const config = JSON.parse(fs.readFileSync(`${CONFIG_FILE}`));

async function verifyContract(address, constructorArguments) {
  try {
    await hre.run('verify:verify', {
      network: CHAIN_NAME,
      address,
      constructorArguments,
    });
  } catch (e) {
    console.error(e);
  }

  console.log('\n'); // add space after each attempt
}

const isTestChain = () => CHAIN_NAME == 'mumbai' || CHAIN_NAME == 'kovan';

async function verifyTestErc20(name, symbol, decimals) {
  const key = symbol.toLowerCase();
  const contractAddress = config['tokens'][key];

  console.log(`[${getDataTime()}] Verify "${name}"(${symbol}) at ${contractAddress}`);
  await verifyContract(contractAddress, [name, symbol, decimals]);
}

async function verifyAllErc20Mocks() {
  if (!isTestChain()) {
    return;
  }

  for (const token of testTokens[CHAIN_NAME]) {
    await verifyTestErc20(token.name, token.symbol, token.decimals);
  }
}

async function verifyController() {
  const { fee_recipient: feeRecipient } = config;
  if (!feeRecipient) {
    throw new Error(`Must set fee_recipient in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller } = contractAddresses;

  if (!controller) {
    throw new Error(`Fail to verify Controller because controller is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify Controller at ${controller}`);
  await verifyContract(controller, [feeRecipient]);
}

async function verifyWithoutController(name, key) {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const contractAddress = contractAddresses[key];

  if (!contractAddress) {
    throw new Error(`Fail to read contract ${name}'s address ${key} in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} at ${contractAddress}`);
  await verifyContract(contractAddress, []);
}

async function verifyWithController(name, key) {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, [key]: contractAddress } = contractAddresses;

  if (!controller || !contractAddress) {
    throw new Error(`Fail to verify ${name} because controller or ${key} is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} at ${contractAddress}`);
  await verifyContract(contractAddress, [controller]);
}

async function verifyWithControllerAndWeth(name, key) {
  const weth = getWeth(config, CHAIN_NAME);

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, [key]: contractAddress } = contractAddresses;

  if (!controller || !contractAddress) {
    throw new Error(`Fail to verify ${name} because controller or ${key} is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} at ${contractAddress}`);
  await verifyContract(contractAddress, [controller, weth]);
}

async function verifyAaveLeverageModule() {
  const { aave_v2_lending_pool_addresses_provider: lpap } = config;
  if (!lpap) {
    throw new Error(`Must set aave_v2_lending_pool_addresses_provider in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, aave_leverage_module: contractAddress } = contractAddresses;

  if (!controller || !contractAddress) {
    throw new Error(`Fail to verify AaveLeverageModule because controller or aave_leverage_module is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify AaveLeverageModule at ${contractAddress}`);
  await verifyContract(contractAddress, [controller, lpap]);
}

async function verifyPriceOracle() {
  const { usd } = config['tokens'];
  if (!usd) {
    throw new Error('Must set usd in file ${CONFIG_FILE} !');
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, price_oracle: priceOracle } = contractAddresses;

  if (!controller || !priceOracle) {
    throw new Error(`Fail to verify PriceOracle because controller or price_oracle is not exist in file ${filename} !`);
  }

  await verifyContract(priceOracle, [controller, usd, [], [], [], []]);
}

async function verifyChainlinkOracle(name, key, priceFeed) {
  const { contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const contractAddress = contractAddresses[key];

  console.log(`[${getDataTime()}] Verify ChainlinkOracle ${name} ${key} at ${contractAddress}`);
  await verifyContract(contractAddress, [name, priceFeed]);
}

function getPriceFeed(oracleKey) {
  const { chainlink_oracle: chainlinkOracles } = oracles[CHAIN_NAME];

  for (const oracle of chainlinkOracles) {
    if (oracle.key == oracleKey) {
      return oracle.address;
    }
  }

  throw new Error(`${oracleKey} is not exist in chainlink_oracle[${CHAIN_NAME}] !`);
}

async function verifyChainlinkSerialOracle(name, key, path) {
  const task = `verify ChainlinkSerialOracle(${name}, ${key}, [${path}])`;
  if (path.length != 3) {
    throw new Error(`${task}: length of [${path}] is not 3 !`);
  }

  const oracle1 = `${path[0]}_${path[1]}_oracle`;
  const oracle2 = `${path[1]}_${path[2]}_oracle`;

  const priceFeed1 = getPriceFeed(oracle1);
  const priceFeed2 = getPriceFeed(oracle2);

  const { contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { [key]: contractAddress } = contractAddresses;

  console.log(`[${getDataTime()}] Verify ChainlinkSerialOracle ${name} ${key} at ${contractAddress}`);
  await verifyContract(contractAddress, [name, priceFeed1, priceFeed2]);
}

async function verifyChainlinkOracles() {
  const { chainlink_oracle: chainlinkOracles, chainlink_serial_oracle: chainlinkSerialOracles } = oracles[CHAIN_NAME];

  for (const oracle of chainlinkOracles) {
    await verifyChainlinkOracle(oracle.name, oracle.key, oracle.address);
  }

  for (const oracle of chainlinkSerialOracles) {
    await verifyChainlinkSerialOracle(oracle.name, oracle.key, oracle.path);
  }
}

async function verifyExchangeAdapter(name, key, routerKey) {
  const router = config[routerKey];
  if (!router) {
    throw new Error(`Must set ${routerKey} in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const contractAddress = contractAddresses[key];

  if (!contractAddress) {
    throw new Error(`Fail to verify ${name} because ${key} is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} ${key} at ${contractAddress}`);
  await verifyContract(contractAddress, [router]);
}

async function verifyChainlinkOracleAdapter() {
  const { chainlink_feed_registry: registry } = config;
  if (!registry) {
    throw new Error(`verify ChainlinkOracleAdapter: must set chainlink_feed_registry in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { chainlink_oracle_adapter: contractAddress } = contractAddresses;

  if (!contractAddress) {
    throw new Error(`Fail to verify ChainlinkOracleAdapter because chainlink_oracle_adapter is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ChainlinkOracleAdapter at ${contractAddress}`);
  await verifyContract(contractAddress, [registry]);
}

async function verifyChainlinkSerialOracleAdapter() {
  const task = `verify ChainlinkSerialOracleAdapter`;

  const { chainlink_feed_registry: registry } = config;
  if (!registry) {
    throw new Error(`${task}: must set chainlink_feed_registry in file ${CONFIG_FILE} !`);
  }

  const { eth } = config['tokens'];
  if (!eth) {
    throw new Error(`${task}: must set "tokens"."eth" in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { chainlink_serial_oracle_adapter: contractAddress } = contractAddresses;

  if (!contractAddress) {
    throw new Error(`FAIL: ${task} because chainlink_serial_oracle_adapter is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ChainlinkSerialOracleAdapter at ${contractAddress}`);
  await verifyContract(contractAddress, [registry, eth]);
}

async function verifyWithPriceOracle(name, key) {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { [key]: contractAddress, price_oracle: priceOracle } = contractAddresses;

  if (!priceOracle) {
    throw new Error(`deploy ${name}: must set price_oracle in file ${filename} !`);
  }

  if (!contractAddress) {
    throw new Error(`Fail to verify ${name} because ${key} is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} ${key} at ${contractAddress}`);
  await verifyContract(contractAddress, [priceOracle]);
}

async function verifyAaveV2WrapV2Adapter() {
  const { aave_v2_lending_pool_addresses_provider: lpap } = config;
  if (!lpap) {
    throw new Error(`Must set aave_v2_lending_pool_addresses_provider in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { aave_v2_wrap_v2_adapter: contractAddress } = contractAddresses;

  if (!contractAddress) {
    throw new Error(`Fail to verify AaveV2WrapV2Adapter because aave_v2_wrap_v2_adapter is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify AaveV2WrapV2Adapter at ${contractAddress}`);
  await verifyContract(contractAddress, [lpap]);
}

async function verifyAdapters() {
  if (CHAIN_NAME == 'mainnet' || CHAIN_NAME == 'kovan') {
    await verifyChainlinkOracleAdapter();
    await verifyChainlinkSerialOracleAdapter();
  }

  await verifyWithPriceOracle('IdenticalTokenOracleAdapter', 'identical_token_oracle_adapter');
  await verifyWithPriceOracle('UniswapV2PairPriceAdapter', 'uniswap_v2_pair_price_adapter');

  if (CHAIN_NAME != 'kovan') {
    await verifyExchangeAdapter('KyberV1ExchangeAdapter', 'kyber_v1_exchange_adapter', 'kyber_v1_router');
    // await verifyExchangeAdapter('KyberV1ExchangeAdapterV2', 'kyber_v1_exchange_adapter_v2', 'kyber_v1_router');
  }

  if (CHAIN_NAME == 'polygon' || CHAIN_NAME == 'mumbai') {
    await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'quickswap_exchange_adapter', 'quickswap_router');
    // await verifyExchangeAdapter('UniswapV2ExchangeAdapterV2', 'quickswap_exchange_adapter_v2', 'quickswap_router');
  }

  await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'sushi_v2_exchange_adapter', 'sushi_v2_router02');

  if (CHAIN_NAME != 'polygon' && CHAIN_NAME != 'mumbai') {
    await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'uniswap_v2_exchange_adapter', 'uniswap_v2_router02');
    // await verifyExchangeAdapter('UniswapV2ExchangeAdapterV2', 'uniswap_v2_exchange_adapter_v2', 'uniswap_v2_router02');
  }

  await verifyExchangeAdapter('UniswapV3ExchangeAdapter', 'uniswap_v3_exchange_adapter', 'uniswap_v3_swap_router02');
  await verifyAaveV2WrapV2Adapter();
}

async function verifyMatrixToken() {
  const name = 'MatrixToken';
  const key = 'test_matrix_token';
  const manager = config['fee_recipient'];
  const weth = getWeth(config, CHAIN_NAME);
  const unit = WEI_PER_ETHER;

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, [key]: contractAddress, basic_issuance_module: module } = contractAddresses;

  if (!controller || !contractAddress || !module) {
    throw new Error(`Fail to verify ${name} because controller or basic_issuance_module or ${key} is not exist in file ${filename} !`);
  }

  console.log(`[${getDataTime()}] Verify ${name} at ${contractAddress}`);
  await verifyContract(contractAddress, [[weth], [unit], [module], controller, manager, 'Matrix Token', 'MT']);
}

async function verifyAll() {
  // await verifyAllErc20Mocks();
  await verifyWithoutController('ProtocolViewer', 'protocol_viewer');
  await verifyWithoutController('AaveV2', 'aave_v2');
  await verifyController();
  await verifyPriceOracle();
  await verifyWithController('MatrixValuer', 'matrix_valuer');
  await verifyWithController('MatrixTokenFactory', 'matrix_token_factory');
  await verifyWithController('IntegrationRegistry', 'integration_registry');
  await verifyWithController('BasicIssuanceModule', 'basic_issuance_module');
  // await verifyWithController('IssuanceModule', 'issuance_module');
  await verifyWithController('StreamingFeeModule', 'streaming_fee_module');
  // await verifyWithController('DebtIssuanceModule', 'debt_issuance_module');
  // await verifyWithController('DebtIssuanceModuleV2', 'debt_issuance_module_v2');
  await verifyWithControllerAndWeth('NavIssuanceModule', 'nav_issuance_module');
  await verifyWithControllerAndWeth('WrapModuleV2', 'wrap_module_v2');
  // await verifyAaveLeverageModule();
  await verifyWithController('TradeModule', 'trade_module');
  await verifyWithController('AirdropModule', 'airdrop_module');
  // await verifyWithController('StakingModule', 'staking_module');
  await verifyMatrixToken();
  await verifyAdapters();
  await verifyChainlinkOracles();
}

async function verify() {
  const target = process.env.TARGET ? process.env.TARGET.toUpperCase() : 'ALL';

  switch (target) {
    case 'Erc20Mock'.toUpperCase():
      await verifyAllErc20Mocks();
      break;

    case 'Chainlink'.toUpperCase():
      await verifyChainlinkOracles();
      break;

    case 'protocol_viewer'.toUpperCase():
    case 'ProtocolViewer'.toUpperCase():
      await verifyWithoutController('ProtocolViewer', 'protocol_viewer');
      break;

    case 'Controller'.toUpperCase():
      await verifyController();
      break;

    case 'matrix_valuer'.toUpperCase():
    case 'MatrixValuer'.toUpperCase():
      await verifyWithController('MatrixValuer', 'matrix_valuer');
      break;

    case 'matrix_token_factory'.toUpperCase():
    case 'MatrixTokenFactory'.toUpperCase():
      await verifyWithController('MatrixTokenFactory', 'matrix_token_factory');
      break;

    case 'integration_registry'.toUpperCase():
    case 'IntegrationRegistry'.toUpperCase():
      await verifyWithController('IntegrationRegistry', 'integration_registry');
      break;

    case 'price_oracle'.toUpperCase():
    case 'PriceOracle'.toUpperCase():
      await verifyPriceOracle();
      break;

    case 'basic_issuance_module'.toUpperCase():
    case 'BasicIssuanceModule'.toUpperCase():
      await verifyWithController('BasicIssuanceModule', 'basic_issuance_module');
      break;

    case 'issuance_module'.toUpperCase():
    case 'IssuanceModule'.toUpperCase():
      await verifyWithController('IssuanceModule', 'issuance_module');
      break;

    case 'streaming_fee_module'.toUpperCase():
    case 'StreamingFeeModule'.toUpperCase():
      await verifyWithController('StreamingFeeModule', 'streaming_fee_module');
      break;

    case 'debt_issuance_module'.toUpperCase():
    case 'DebtIssuanceModule'.toUpperCase():
      await verifyWithController('DebtIssuanceModule', 'debt_issuance_module');
      break;

    case 'debt_issuance_module_v2'.toUpperCase():
    case 'DebtIssuanceModuleV2'.toUpperCase():
      await verifyWithController('DebtIssuanceModuleV2', 'debt_issuance_module_v2');
      break;

    case 'trade_module'.toUpperCase():
    case 'TradeModule'.toUpperCase():
      await verifyWithController('TradeModule', 'trade_module');
      break;

    case 'airdrop_module'.toUpperCase():
    case 'AirdropModule'.toUpperCase():
      await verifyWithController('AirdropModule', 'airdrop_module');
      break;

    case 'staking_module'.toUpperCase():
    case 'StakingModule'.toUpperCase():
      await verifyWithController('StakingModule', 'staking_module');
      break;

    case 'nav_issuance_module'.toUpperCase():
    case 'NavIssuanceModule'.toUpperCase():
      await verifyWithControllerAndWeth('NavIssuanceModule', 'nav_issuance_module');
      break;

    case 'wrap_module_v2'.toUpperCase():
    case 'WrapModuleV2'.toUpperCase():
      await verifyWithControllerAndWeth('WrapModuleV2', 'wrap_module_v2');
      break;

    case 'aave_leverage_module'.toUpperCase():
    case 'AaveLeverageModule'.toUpperCase():
      await verifyAaveLeverageModule();
      break;

    case 'kyber_v1_exchange_adapter'.toUpperCase():
    case 'KyberV1ExchangeAdapter'.toUpperCase():
      await verifyExchangeAdapter('KyberV1ExchangeAdapter', 'kyber_v1_exchange_adapter', 'kyber_v1_router');
      break;

    case 'kyber_v1_exchange_adapter_v2'.toUpperCase():
    case 'KyberV1ExchangeAdapterV2'.toUpperCase():
      await verifyExchangeAdapter('KyberV1ExchangeAdapterV2', 'kyber_v1_exchange_adapter_v2', 'kyber_v1_router');
      break;

    case 'quick_swap_exchange_adapter'.toUpperCase():
    case 'QuickSwapExchangeAdapter'.toUpperCase():
      await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'quickswap_exchange_adapter', 'quickswap_router');
      break;

    case 'quick_swap_exchange_adapter_v2'.toUpperCase():
    case 'QuickSwapExchangeAdapterV2'.toUpperCase():
      await verifyExchangeAdapter('UniswapV2ExchangeAdapterV2', 'quickswap_exchange_adapter_v2', 'quickswap_router');
      break;

    case 'sushi_v2_exchange_adapter'.toUpperCase():
    case 'SushiV2ExchangeAdapter'.toUpperCase():
      await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'sushi_v2_exchange_adapter', 'sushi_v2_router02');
      break;

    case 'uniswap_v2_exchange_adapter'.toUpperCase():
    case 'UniswapV2ExchangeAdapter'.toUpperCase():
      await verifyExchangeAdapter('UniswapV2ExchangeAdapter', 'uniswap_v2_exchange_adapter', 'uniswap_v2_router02');
      break;

    case 'uniswap_v2_exchange_adapter_v2'.toUpperCase():
    case 'UniswapV2ExchangeAdapterV2'.toUpperCase():
      await verifyExchangeAdapter('UniswapV2ExchangeAdapterV2', 'uniswap_v2_exchange_adapter_v2', 'uniswap_v2_router02');
      break;

    case 'uniswap_v3_exchange_adapter'.toUpperCase():
    case 'UniswapV3ExchangeAdapter'.toUpperCase():
      await verifyExchangeAdapter('UniswapV3ExchangeAdapter', 'uniswap_v3_exchange_adapter', 'uniswap_v3_swap_router');
      break;

    case 'chainlink_oracle_adapter'.toUpperCase():
    case 'ChainlinkOracleAdapter'.toUpperCase():
      await verifyChainlinkOracleAdapter();
      break;

    case 'chainlink_serial_oracle_adapter'.toUpperCase():
    case 'ChainlinkSerialOracleAdapter'.toUpperCase():
      await verifyChainlinkSerialOracleAdapter();
      break;

    case 'identical_token_oracle_adapter'.toUpperCase():
    case 'IdenticalTokenOracleAdapter'.toUpperCase():
      await verifyWithPriceOracle('IdenticalTokenOracleAdapter', 'identical_token_oracle_adapter');
      break;

    case 'uniswap_v2_pair_price_adapter'.toUpperCase():
    case 'UniswapV2PairPriceAdapter'.toUpperCase():
      await verifyWithPriceOracle('UniswapV2PairPriceAdapter', 'uniswap_v2_pair_price_adapter');
      break;

    case 'aave_v2_wrap_v2_adapter'.toUpperCase():
    case 'AaveV2WrapV2Adapter'.toUpperCase():
      await verifyAaveV2WrapV2Adapter();
      break;

    case 'matrix_token'.toUpperCase():
    case 'MatrixToken'.toUpperCase():
      await verifyMatrixToken();
      break;

    default:
      console.log(`verify all contracts\n`);
      await verifyAll();
  }
}

verify()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
