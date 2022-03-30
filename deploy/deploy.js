// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const fs = require('fs');
const hre = require('hardhat');
const dotenv = require('dotenv');

// ==================== Internal Imports ====================

const { ZERO_ADDRESS, WEI_PER_ETHER } = require('./constants');
const oracles = require('./configs/oracles.json');
const testTokens = require('./configs/testTokens.json');

const {
  sleep,
  getWeth,
  joinByFlags,
  getDeployer,
  deployContract,
  deployContractAndLinkLibraries,
  getDeployedAddresses,
  writeDeployedAddresses,
  getDataTime,
} = require('./helpers');

dotenv.config();

const { DEPLOYER_PRIVATE_KEY } = process.env;
if (!DEPLOYER_PRIVATE_KEY) {
  throw new Error(`DEPLOYER_PRIVATE_KEY is not set in file .env !}`);
}

const CHAIN_NAME = hre.network.name;
const CHAIN_ID = hre.network.config.chainId;
const RPC_ENDPOINT = hre.network.config.url;
console.log(`\nCHAIN_NAME = ${CHAIN_NAME}, CHAIN_ID = ${CHAIN_ID}\n`);

const deployer = getDeployer(RPC_ENDPOINT, DEPLOYER_PRIVATE_KEY);
const CONFIG_DIR = `./deploy/configs`;
const CONFIG_FILE = `./deploy/configs/${CHAIN_NAME}.json`;
const config = JSON.parse(fs.readFileSync(CONFIG_FILE));

async function deployTestErc20(name, symbol, decimals) {
  const key = symbol.toLowerCase();
  const oldAddress = config['tokens'][key];
  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: "${name}" is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy "${name}" to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, 'Erc20Mock', [name, symbol, decimals]);
  console.log(`[${getDataTime()}] OK: "${name}" is deployed at ${instance.address}`);

  // update addresses
  config['tokens'][key] = instance.address;
  writeDeployedAddresses(CONFIG_DIR, CONFIG_FILE, config);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${CONFIG_FILE}\n`);

  return instance.address;
}

async function deployAllMocks() {
  if (CHAIN_NAME != 'mumbai' && CHAIN_NAME != 'kovan') {
    return;
  }

  for (const token of testTokens[CHAIN_NAME]) {
    await deployTestErc20(token.name, token.symbol, token.decimals);
  }
}

async function deployController() {
  const { fee_recipient: feeRecipient } = config;
  if (!feeRecipient) {
    throw new Error(`deploy Controller: fee_recipient is not set in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const controllerAddress = contractAddresses['controller'];
  if (controllerAddress) {
    console.log(`[${getDataTime()}] SKIP: Controller is already deployed at ${controllerAddress}\n`);
    return controllerAddress;
  }

  // Deploy contract Controller
  console.log(`[${getDataTime()}] DO: Deploy Controller to ${CHAIN_NAME}`);
  const controller = await deployContract(deployer, 'Controller', [feeRecipient]);
  console.log(`[${getDataTime()}] OK: Controller is deployed at ${controller.address}`);

  // update the Controller addresses
  contractAddresses['controller'] = controller.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write controller to file ${filename}\n`);

  return controller.address;
}

async function deployWithController(name, key) {
  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, [key]: oldAddress } = contractAddresses;

  if (!controller) {
    throw new Error(`deployWithController: controller is not set in file ${filename} !`);
  }

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy ${name} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, name, [controller]);
  console.log(`[${getDataTime()}] OK: ${name} is deployed at ${instance.address}`);

  // update addresses
  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

async function deployWithoutController(name, key) {
  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const oldAddress = contractAddresses[key];

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy ${name} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, name);
  console.log(`[${getDataTime()}] OK: ${name} is deployed at ${instance.address}`);

  // update addresses
  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

async function deployWithControllerAndWeth(name, key) {
  const weth = getWeth(config, CHAIN_NAME);

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, [key]: oldAddress } = contractAddresses;

  if (!controller) {
    throw new Error(`deployWithControllerAndWeth: must set controller in file ${filename} !`);
  }

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy ${name} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, name, [controller, weth]);
  console.log(`[${getDataTime()}] OK: ${name} is deployed at ${instance.address}`);

  // update the addresses
  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

// eslint-disable-next-line no-unused-vars
async function deployAaveLeverageModule() {
  const { aave_v2_lending_pool_addresses_provider: lpap } = config;
  if (!lpap) {
    throw new Error(`deploy AaveLeverageModule: must set aave_v2_lending_pool_addresses_provider in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, aave_v2: aaveV2, aave_leverage_module: oldAddress } = contractAddresses;

  if (!controller) {
    throw new Error(`deployAaveLeverageModule: must set controller in file ${filename} !`);
  }

  if (!aaveV2) {
    throw new Error(`deployAaveLeverageModule: must set aave_v2 in file ${filename} !`);
  }

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: AaveLeverageModule is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract AaveLeverageModule
  console.log(`[${getDataTime()}] DO: Deploy AaveLeverageModule to ${CHAIN_NAME}`);
  const aaveLeverageModule = await deployContractAndLinkLibraries(deployer, 'AaveLeverageModule', [controller, lpap], { AaveV2: aaveV2 });
  console.log(`[${getDataTime()}] OK: AaveLeverageModule is deployed at ${aaveLeverageModule.address}`);

  // update the AaveLeverageModule addresses
  contractAddresses['aave_leverage_module'] = aaveLeverageModule.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write aave_leverage_module to file ${filename}\n`);

  return aaveLeverageModule.address;
}

async function deployPriceOracle() {
  const { usd } = config['tokens'];
  if (!usd) {
    throw new Error(`deploy PriceOracle: must set "tokens"."usd" in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, price_oracle: oldAddress } = contractAddresses;

  if (!controller) {
    throw new Error(`deployPriceOracle: must set controller in file ${filename} !`);
  }

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: PriceOracle is already deployed at ${oldAddress}\n`);
    return;
  }

  // Deploy contract PriceOracle
  console.log(`[${getDataTime()}] DO: Deploy PriceOracle to ${CHAIN_NAME}`);
  const priceOracle = await deployContract(deployer, 'PriceOracle', [controller, usd, [], [], [], []]);
  console.log(`[${getDataTime()}] OK: PriceOracle is deployed at ${priceOracle.address}`);

  // update the PriceOracle addresses
  contractAddresses['price_oracle'] = priceOracle.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write price_oracle to file ${filename}\n`);
}

async function deployChainlinkOracle(name, key, priceFeed) {
  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);

  const task = `Deploy ChainlinkOracle ${name} ${key} to ${CHAIN_NAME}`;
  const oldAddress = contractAddresses[key];
  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${task} at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: ${task}`);
  const oracle = await deployContract(deployer, 'ChainlinkOracle', [name, priceFeed]);
  console.log(`[${getDataTime()}] OK: ${task}`);

  // update addresses
  contractAddresses[key] = oracle.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return oracle.address;
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

async function deployChainlinkSerialOracle(name, key, path) {
  const task = `deploy ChainlinkSerialOracle(${name}, ${key}, [${path}]) to ${CHAIN_NAME}`;

  if (path.length != 3) {
    throw new Error(`${task}: length of [${path}] is not 3 !`);
  }

  const oracle1 = `${path[0]}_${path[1]}_oracle`;
  const oracle2 = `${path[1]}_${path[2]}_oracle`;

  const priceFeed1 = getPriceFeed(oracle1);
  const priceFeed2 = getPriceFeed(oracle2);

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { [key]: oldAddress } = contractAddresses;

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${task} at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: ${task}`);
  const oracle = await deployContract(deployer, 'ChainlinkSerialOracle', [name, priceFeed1, priceFeed2]);
  console.log(`[${getDataTime()}] OK: ${task}`);

  // update addresses
  contractAddresses[key] = oracle.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return oracle.address;
}

async function deployChainlinkOracleAdapter() {
  const task = `deploy ChainlinkOracleAdapter to ${CHAIN_NAME}`;

  const { chainlink_feed_registry: registry } = config;
  if (!registry) {
    throw new Error(`${task}: must set chainlink_feed_registry in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { chainlink_oracle_adapter: oldAddress } = contractAddresses;

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${task} at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: ${task}`);
  const instance = await deployContract(deployer, 'ChainlinkOracleAdapter', [registry]);
  console.log(`[${getDataTime()}] OK: ${task}`);

  // update addresses
  contractAddresses['chainlink_oracle_adapter'] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write chainlink_oracle_adapter to file ${filename}\n`);

  return instance.address;
}

async function deployChainlinkSerialOracleAdapter() {
  const task = `deploy ChainlinkSerialOracleAdapter to ${CHAIN_NAME}`;

  const { chainlink_feed_registry: registry } = config;
  if (!registry) {
    throw new Error(`${task}: must set chainlink_feed_registry in file ${CONFIG_FILE} !`);
  }

  const { eth } = config['tokens'];
  if (!eth) {
    throw new Error(`${task}: must set "tokens"."eth" in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { chainlink_serial_oracle_adapter: oldAddress } = contractAddresses;

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${task} at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: ${task}`);
  const instance = await deployContract(deployer, 'ChainlinkSerialOracleAdapter', [registry, eth]);
  console.log(`[${getDataTime()}] OK: ${task}`);

  // update addresses
  contractAddresses['chainlink_serial_oracle_adapter'] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write chainlink_serial_oracle_adapter to file ${filename}\n`);

  return instance.address;
}

async function deployOracles() {
  const { chainlink_oracle: chainlinkOracles, chainlink_serial_oracle: chainlinkSerialOracles } = oracles[CHAIN_NAME];

  for (const oracle of chainlinkOracles) {
    await deployChainlinkOracle(oracle.name, oracle.key, oracle.address);
  }

  for (const oracle of chainlinkSerialOracles) {
    await deployChainlinkSerialOracle(oracle.name, oracle.key, oracle.path);
  }
}

async function deployExchangeAdapter(name, key, routerKey) {
  const router = config[routerKey];
  if (!router) {
    throw new Error(`deploy ExchangeAdapter: must set ${routerKey} in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const oldAddress = contractAddresses[key];

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} ${key} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy ${name} ${key} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, name, [router]);
  console.log(`[${getDataTime()}] OK: ${name} ${key} is deployed at ${instance.address}`);

  // update addresses
  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

async function deployWithPriceOracle(name, key) {
  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { [key]: oldAddress, price_oracle: priceOracle } = contractAddresses;

  if (!priceOracle) {
    throw new Error(`deploy ${name}: must set price_oracle in file ${filename} !`);
  }

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} ${key} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract
  console.log(`[${getDataTime()}] DO: Deploy ${name} ${key} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, name, [priceOracle]);
  console.log(`[${getDataTime()}] OK: ${name} ${key} is deployed at ${instance.address}`);

  // update addresses
  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

async function addPairToIdenticalTokenOracleAdapter(identicalTokenKey, underlyingTokenKey) {
  const adapterKey = 'identical_token_oracle_adapter';
  const task = `IdenticalTokenOracleAdapter ${adapterKey} add pair (${identicalTokenKey}, ${underlyingTokenKey})`;

  const { [identicalTokenKey]: identicalToken, [underlyingTokenKey]: underlyingToken } = config['tokens'];
  if (!identicalToken) {
    throw new Error(`${task}: must set ${identicalTokenKey} in file ${CONFIG_FILE} !`);
  }
  if (!underlyingToken) {
    throw new Error(`${task}: must set ${underlyingTokenKey} in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const adapterAddress = contractAddresses[adapterKey];
  if (!adapterAddress) {
    throw new Error(`${task}: must set ${adapterKey} in file ${filename} !`);
  }

  const adapterImplementation = await hre.ethers.getContractFactory('IdenticalTokenOracleAdapter', deployer);
  const adapter = adapterImplementation.attach(adapterAddress);

  if ((await adapter.getUnderlyingToken(identicalToken)) == underlyingToken) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await adapter.addPair(identicalToken, underlyingToken);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if ((await adapter.getUnderlyingToken(identicalToken)) == underlyingToken) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function addQuoteAssetToUniswapV2PairPriceAdapter(assetKey) {
  const adapterKey = 'uniswap_v2_pair_price_adapter';
  const task = `UniswapV2PairPriceAdapter ${adapterKey} add quote asset ${assetKey}`;

  const asset = config['tokens'][assetKey];
  if (!asset) {
    throw new Error(`${task}: must set ${assetKey} in file ${CONFIG_FILE} !`);
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const adapterAddress = contractAddresses[adapterKey];
  if (!adapterAddress) {
    throw new Error(`${task}: must set ${adapterKey} in file ${filename} !`);
  }

  const adapterImplementation = await hre.ethers.getContractFactory('UniswapV2PairPriceAdapter', deployer);
  const adapter = adapterImplementation.attach(adapterAddress);

  const quoteAssets = await adapter.getQuoteAssets();
  if (quoteAssets.indexOf(asset) >= 0) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await adapter.addQuoteAsset(asset);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const quoteAssets = await adapter.getQuoteAssets();
    if (quoteAssets.indexOf(asset) >= 0) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function deployAaveV2WrapV2Adapter() {
  const { aave_v2_lending_pool_addresses_provider: lpap } = config;
  if (!lpap) {
    throw new Error(`deploy AaveV2WrapV2Adapter: must set aave_v2_lending_pool_addresses_provider in file ${CONFIG_FILE} !`);
  }

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { aave_v2_wrap_v2_adapter: oldAddress } = contractAddresses;

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: AaveV2WrapV2Adapter is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  // Deploy contract AaveV2WrapV2Adapter
  console.log(`[${getDataTime()}] DO: Deploy AaveV2WrapV2Adapter to ${CHAIN_NAME}`);
  const aaveV2WrapV2Adapter = await deployContractAndLinkLibraries(deployer, 'AaveV2WrapV2Adapter', [lpap]);
  console.log(`[${getDataTime()}] OK: AaveV2WrapV2Adapter is deployed at ${aaveV2WrapV2Adapter.address}`);

  // update the AaveV2WrapV2Adapter addresses
  contractAddresses['aave_v2_wrap_v2_adapter'] = aaveV2WrapV2Adapter.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write aave_v2_wrap_v2_adapter to file ${filename}\n`);

  return aaveV2WrapV2Adapter.address;
}

async function deployAdapters() {
  if (CHAIN_NAME == 'mainnet' || CHAIN_NAME == 'kovan') {
    await deployChainlinkOracleAdapter();
    await deployChainlinkSerialOracleAdapter();
  }

  await deployWithPriceOracle('IdenticalTokenOracleAdapter', 'identical_token_oracle_adapter');

  await deployWithPriceOracle('UniswapV2PairPriceAdapter', 'uniswap_v2_pair_price_adapter');
  await addQuoteAssetToUniswapV2PairPriceAdapter('usd');
  await addQuoteAssetToUniswapV2PairPriceAdapter('eth');

  if (CHAIN_NAME != 'kovan') {
    await deployExchangeAdapter('KyberV1ExchangeAdapter', 'kyber_v1_exchange_adapter', 'kyber_v1_router');
    // await deployExchangeAdapter('KyberV1ExchangeAdapterV2', 'kyber_v1_exchange_adapter_v2', 'kyber_v1_router');
  }

  if (CHAIN_NAME == 'polygon' || CHAIN_NAME == 'mumbai') {
    await deployExchangeAdapter('UniswapV2ExchangeAdapter', 'quickswap_exchange_adapter', 'quickswap_router');
    // await deployExchangeAdapter('UniswapV2ExchangeAdapterV2', 'quickswap_exchange_adapter_v2', 'quickswap_router');
  }

  await deployExchangeAdapter('UniswapV2ExchangeAdapter', 'sushi_v2_exchange_adapter', 'sushi_v2_router02');

  if (CHAIN_NAME != 'polygon' && CHAIN_NAME != 'mumbai') {
    await deployExchangeAdapter('UniswapV2ExchangeAdapter', 'uniswap_v2_exchange_adapter', 'uniswap_v2_router02');
    // await deployExchangeAdapter('UniswapV2ExchangeAdapterV2', 'uniswap_v2_exchange_adapter_v2', 'uniswap_v2_router02');
  }

  await deployExchangeAdapter('UniswapV3ExchangeAdapter', 'uniswap_v3_exchange_adapter', 'uniswap_v3_swap_router');

  await deployAaveV2WrapV2Adapter();
}

// eslint-disable-next-line no-unused-vars
async function removeIntegration(moduleKey, adapterKey) {
  const adapterName = adapterKey.toUpperCase();

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { integration_registry: irAddress, [moduleKey]: moduleAddress } = contractAddresses;

  if (!irAddress) {
    throw new Error(`removeIntegration: must set integration_registry in file ${filename}!`);
  }

  if (!moduleAddress) {
    throw new Error(`removeIntegration: must set ${moduleKey} in file ${filename}!`);
  }

  const integrationRegistryImplementation = await hre.ethers.getContractFactory('IntegrationRegistry', deployer);
  const integrationRegistry = integrationRegistryImplementation.attach(irAddress);

  // const moduleImplementation = await hre.ethers.getContractAt('ModuleBase', moduleAddress, deployer);
  // const moduleName = await moduleImplementation.getName();

  const task = `IntegrationRegistry remove integration ${adapterName} from ${moduleKey}`;
  if ((await integrationRegistry.getIntegrationAdapter(moduleAddress, adapterName)) == ZERO_ADDRESS) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await integrationRegistry.removeIntegration(moduleAddress, adapterName);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if ((await integrationRegistry.getIntegrationAdapter(moduleAddress, adapterName)) == ZERO_ADDRESS) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function addIntegration(moduleKey, adapterKey) {
  const adapterName = adapterKey.toUpperCase();

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { integration_registry: irAddress, [moduleKey]: moduleAddress, [adapterKey]: adapterAddress } = contractAddresses;

  if (!irAddress) {
    throw new Error(`addIntegration: must set integration_registry in file ${filename}!`);
  }

  if (!moduleAddress) {
    throw new Error(`addIntegration: must set ${moduleKey} in file ${filename}!`);
  }

  if (!adapterAddress) {
    throw new Error(`addIntegration: must set ${adapterKey} in file ${filename}!`);
  }

  const integrationRegistryImplementation = await hre.ethers.getContractFactory('IntegrationRegistry', deployer);
  const integrationRegistry = integrationRegistryImplementation.attach(irAddress);

  // const moduleImplementation = await hre.ethers.getContractAt('ModuleBase', moduleAddress, deployer);
  // const moduleName = await moduleImplementation.getName();

  const task = `IntegrationRegistry add integration ${adapterKey} to ${moduleKey}`;
  const oldAdapterAddress = await integrationRegistry.getIntegrationAdapter(moduleAddress, adapterName);

  if (oldAdapterAddress == adapterAddress) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  if (oldAdapterAddress != ZERO_ADDRESS) {
    throw new Error(`${task}: adapter is already exist`);
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await integrationRegistry.addIntegration(moduleAddress, adapterName, adapterAddress);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if ((await integrationRegistry.getIntegrationAdapter(moduleAddress, adapterName)) == adapterAddress) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function editSecondQuoteAssetOfPriceOracle(priceOracle) {
  const task = `PriceOracle editSecondQuoteAsset`;

  const { eth: secondQuoteAsset } = config['tokens'];
  if (!secondQuoteAsset) {
    throw new Error(`${task}: must set "tokens"."eth" in file ${CONFIG_FILE} !`);
  }

  const oldQuoteAsset = await priceOracle.getSecondQuoteAsset();
  if (oldQuoteAsset.toUpperCase() == secondQuoteAsset.toUpperCase()) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await priceOracle.editSecondQuoteAsset(secondQuoteAsset);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const newSecondQuoteAsset = await priceOracle.getSecondQuoteAsset();
    if (newSecondQuoteAsset.toUpperCase() == secondQuoteAsset.toUpperCase()) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function addOracleToPriceOracle(priceOracle, oracle_key) {
  const [asset1, asset2] = oracle_key.split('_');
  const task = `PriceOracle add ${oracle_key}`;

  const { [asset1]: asset1Address, [asset2]: asset2Address } = config['tokens'];
  const names = joinByFlags([asset1Address, asset2Address], [asset1, asset2]);
  if (names) {
    console.log(`must set ${names} in file ${CONFIG_FILE} !`);
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const oracleAddress = contractAddresses[oracle_key];
  if (!oracleAddress) {
    throw new Error(`${task}: must set ${oracle_key} in file ${filename} !`);
  }

  const oldOracleAddress = await priceOracle.getOracle(asset1Address, asset2Address);
  if (oldOracleAddress.toUpperCase() == oracleAddress.toUpperCase()) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  if (oldOracleAddress != ZERO_ADDRESS) {
    throw new Error(`${task}: oracle is already exist`);
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await priceOracle.addPair(asset1Address, asset2Address, oracleAddress);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const newOracleAddress = await priceOracle.getOracle(asset1Address, asset2Address);
    if (newOracleAddress.toUpperCase() == oracleAddress.toUpperCase()) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function addAdapterToPriceOracle(priceOracle, adapterKey) {
  const task = `PriceOracle add adapter ${adapterKey}`;

  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const adapterAddress = contractAddresses[adapterKey];
  if (!adapterAddress) {
    throw new Error(`${task}: must set ${adapterKey} in file ${filename} !`);
  }

  const adapters = await priceOracle.getAdapters();
  if (adapters.indexOf(adapterAddress) >= 0) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await priceOracle.addAdapter(adapterAddress);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const adapters = await priceOracle.getAdapters();
    if (adapters.indexOf(adapterAddress) >= 0) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function setupPriceOracle() {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const priceOracleAddress = contractAddresses['price_oracle'];

  if (!priceOracleAddress) {
    throw new Error(`setupPriceOracle: must set price_oracle in file ${filename} !`);
  }

  const priceOracleImplementation = await hre.ethers.getContractFactory('PriceOracle', deployer);
  const priceOracle = priceOracleImplementation.attach(priceOracleAddress);

  // set weth as second quote asset
  await editSecondQuoteAssetOfPriceOracle(priceOracle);

  // add all oracles
  const { chainlink_oracle: chainlinkOracles, chainlink_serial_oracle: serialOracles, identical_token_pair: identicalTokenPairs } = oracles[CHAIN_NAME];

  for (const oracle of chainlinkOracles) {
    await addOracleToPriceOracle(priceOracle, oracle.key);
  }

  for (const oracle of serialOracles) {
    await addOracleToPriceOracle(priceOracle, oracle.key);
  }

  if (CHAIN_NAME == 'mainnet' || CHAIN_NAME == 'kovan') {
    await addAdapterToPriceOracle(priceOracle, 'chainlink_oracle_adapter');
    await addAdapterToPriceOracle(priceOracle, 'chainlink_serial_oracle_adapter');
  }

  await addAdapterToPriceOracle(priceOracle, 'identical_token_oracle_adapter');

  for (const tokenPair of identicalTokenPairs) {
    const { reserve_token: reserveToken, underlying_token: underlyingToken } = tokenPair;
    await addPairToIdenticalTokenOracleAdapter(reserveToken, underlyingToken);
  }

  await addAdapterToPriceOracle(priceOracle, 'uniswap_v2_pair_price_adapter');
}

async function initController() {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const {
    controller: controllerAddress,
    price_oracle: priceOracle,
    matrix_valuer: matrixValuer,
    matrix_token_factory: matrixTokenFactory,
    integration_registry: integrationRegistry,
  } = contractAddresses;

  const names = joinByFlags(
    [controllerAddress, priceOracle, matrixValuer, matrixTokenFactory, integrationRegistry],
    ['controller', 'price_oracle', 'matrix_valuer', 'matrix_token_factory', 'integration_registry']
  );

  if (names) {
    throw new Error(`initController: must set ${names} in file ${filename} !`);
  }

  const controllerImplementation = await hre.ethers.getContractFactory('Controller', deployer);
  const controller = controllerImplementation.attach(controllerAddress);

  const task = `initialize Controller at ${controllerAddress}`;
  if (await controller.isInitialized()) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return controller;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await controller.initialize([matrixTokenFactory], [], [integrationRegistry, priceOracle, matrixValuer], [0, 1, 2]);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await controller.isInitialized()) {
      console.log(`[${getDataTime()}] OK: ${task}\n`);
      return controller;
    }
  }

  throw new Error(`FAIL: ${task}`);
}

async function addModule(controller, moduleName, moduleKey) {
  const { filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const moduleAddress = contractAddresses[moduleKey];

  if (!moduleAddress) {
    throw new Error(`addModule: must set ${moduleKey} in file ${filename} !`);
  }

  const task = `controller add module ${moduleName} at ${moduleAddress}`;
  let isModule = await controller.isModule(moduleAddress);

  if (isModule) {
    console.log(`[${getDataTime()}] SKIP: ${task}\n`);
    return;
  }

  console.log(`[${getDataTime()}] DO: ${task}`);
  await controller.addModule(moduleAddress);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await controller.isModule(moduleAddress)) {
      isModule = true;
      break;
    }
  }

  if (isModule) {
    console.log(`[${getDataTime()}] OK: ${task}\n`);
  } else {
    throw new Error(`FAIL: ${task}`);
  }
}

async function setupController() {
  const controller = await initController();
  await addModule(controller, 'StreamingFeeModule', 'streaming_fee_module');
  await addModule(controller, 'BasicIssuanceModule', 'basic_issuance_module');
  await addModule(controller, 'NavIssuanceModule', 'nav_issuance_module');
  // await addModule(controller, 'IssuanceModule', 'issuance_module');
  // await addModule(controller, 'DebtIssuanceModule', 'debt_issuance_module');
  // await addModule(controller, 'DebtIssuanceModuleV2', 'debt_issuance_module_v2');
  await addModule(controller, 'TradeModule', 'trade_module');
  await addModule(controller, 'AirdropModule', 'airdrop_module');
  // await addModule(controller, 'AaveLeverageModule', 'aave_leverage_module');
  // await addModule(controller, 'StakingModule', 'staking_module');
  await addModule(controller, 'WrapModuleV2', 'wrap_module_v2');
}

async function setupTradeModule() {
  if (CHAIN_NAME != 'kovan') {
    await addIntegration('trade_module', 'kyber_v1_exchange_adapter');
    // await addIntegration('trade_module', 'kyber_v1_exchange_adapter_v2');
  }

  if (CHAIN_NAME == 'polygon' || CHAIN_NAME == 'mumbai') {
    await addIntegration('trade_module', 'quickswap_exchange_adapter');
    // await addIntegration('trade_module', 'quickswap_exchange_adapter_v2');
  }

  await addIntegration('trade_module', 'sushi_v2_exchange_adapter');

  if (CHAIN_NAME != 'polygon' && CHAIN_NAME != 'mumbai') {
    await addIntegration('trade_module', 'uniswap_v2_exchange_adapter');
    // await addIntegration('trade_module', 'uniswap_v2_exchange_adapter_v2');
  }

  await addIntegration('trade_module', 'uniswap_v3_exchange_adapter');
}

async function setupWrapModuleV2() {
  // await removeIntegration('wrap_module_v2', 'aave_v2_wrap_v2_adapter');
  await addIntegration('wrap_module_v2', 'aave_v2_wrap_v2_adapter');
}

async function deployMatrixToken() {
  const name = 'MatrixToken';
  const key = 'test_matrix_token';
  const manager = config['fee_recipient'];
  const weth = getWeth(config, CHAIN_NAME);
  const unit = WEI_PER_ETHER;

  const { directory, filename, contractAddresses } = getDeployedAddresses(CHAIN_NAME, CHAIN_ID);
  const { controller, basic_issuance_module: module, [key]: oldAddress } = contractAddresses;

  if (oldAddress) {
    console.log(`[${getDataTime()}] SKIP: ${name} is already deployed at ${oldAddress}\n`);
    return oldAddress;
  }

  console.log(`[${getDataTime()}] DO: deploy ${name} to ${CHAIN_NAME}`);
  const instance = await deployContract(deployer, 'MatrixToken', [[weth], [unit], [module], controller, manager, 'Matrix Token', 'MT']);
  console.log(`[${getDataTime()}] OK: ${name} is deployed at ${instance.address}`);

  contractAddresses[key] = instance.address;
  writeDeployedAddresses(directory, filename, contractAddresses);
  console.log(`[${getDataTime()}] OK: Write ${key} to file ${filename}\n`);

  return instance.address;
}

async function deployAll() {
  await deployAllMocks();
  await deployWithoutController('ProtocolViewer', 'protocol_viewer');
  await deployWithoutController('AaveV2', 'aave_v2');
  await deployController();
  await deployWithController('MatrixValuer', 'matrix_valuer');
  await deployWithController('MatrixTokenFactory', 'matrix_token_factory');
  await deployWithController('IntegrationRegistry', 'integration_registry');
  await deployWithController('BasicIssuanceModule', 'basic_issuance_module');
  // await deployWithController('IssuanceModule', 'issuance_module');
  await deployWithController('StreamingFeeModule', 'streaming_fee_module');
  // await deployWithController('DebtIssuanceModule', 'debt_issuance_module');
  // await deployWithController('DebtIssuanceModuleV2', 'debt_issuance_module_v2');
  await deployWithController('TradeModule', 'trade_module');
  await deployWithController('AirdropModule', 'airdrop_module');
  // await deployWithController('StakingModule', 'staking_module');
  await deployWithControllerAndWeth('NavIssuanceModule', 'nav_issuance_module');
  await deployWithControllerAndWeth('WrapModuleV2', 'wrap_module_v2');
  // await deployAaveLeverageModule();
  await deployPriceOracle();
  await deployOracles();
  await deployAdapters();
  await deployMatrixToken(); // deploy MatrixToken for verify contract
  await setupPriceOracle();
  await setupController();
  await setupTradeModule();
  await setupWrapModuleV2();
}

deployAll()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });