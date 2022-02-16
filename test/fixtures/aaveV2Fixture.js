// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');
const { BigNumber } = ethers;

// ==================== Internal Imports ====================

const dependencies = require('./dependencies');
const { ethToWei } = require('../helpers/unitUtil');
const { ZERO_ADDRESS } = require('../helpers/constants');
const { getRandomAddress } = require('../helpers/accountUtil');
const { deployContract, deployContractAndLinkLibraries } = require('../helpers/deploy');

class AaveV2Fixture {
  constructor(owner) {
    this.owner = owner;
  }

  // 1 DAI = 0.001 ETH
  async init(weth, dai, marketId = 'Commons', daiPriceInEth = ethToWei(0.001)) {
    this.marketId = marketId;

    // deploy libraries
    this.genericLogic = await deployContract('GenericLogic', [], this.owner);
    this.reserveLogic = await deployContract('ReserveLogic', [], this.owner);
    this.validationLogic = await deployContractAndLinkLibraries('ValidationLogic', [], { GenericLogic: this.genericLogic.address }, this.owner);

    // deploy contracts
    this.lendingPoolConfigurator = await deployContract('LendingPoolConfigurator', [], this.owner);
    this.lendingPoolCollateralManager = await deployContract('LendingPoolCollateralManager', [], this.owner);
    this.lendingPoolAddressesProvider = await deployContract('LendingPoolAddressesProvider', [this.marketId], this.owner);
    this.protocolDataProvider = await deployContract('AaveProtocolDataProvider', [this.lendingPoolAddressesProvider.address], this.owner);

    this.lendingPool = await deployContractAndLinkLibraries(
      'LendingPool',
      [],
      { ValidationLogic: this.validationLogic.address, ReserveLogic: this.reserveLogic.address },
      this.owner
    );

    this.reserveInterestRateStrategy = await deployContract(
      'DefaultReserveInterestRateStrategy',
      [this.lendingPoolAddressesProvider.address, ethToWei(1), ethToWei(1), ethToWei(1), ethToWei(1), ethToWei(1), ethToWei(1)],
      this.owner
    );

    // deploy oracles
    this.lendingRateOracle = await deployContract('LendingRateOracle', [], this.owner);

    // Aave V2 oracle relies on Chainlink oracle and their fallback oracle. For fixture, we would be deploying a mock fallback oracle
    // with ability to set asset prices on it, which is comparitively easier than deploying multiple chainlink aggregators.
    this.fallbackOracle = await deployContract('AaveV2PriceOracle', [], this.owner);
    this.priceOracle = await deployContract('AaveOracle', [[], [], this.fallbackOracle.address, weth, ethToWei(1)], this.owner);

    // set addresses in LendingPoolAddressProvider
    await this.lendingPoolAddressesProvider.setPriceOracle(this.priceOracle.address);
    await this.lendingPoolAddressesProvider.setLendingRateOracle(this.lendingRateOracle.address);
    await this.lendingPoolAddressesProvider.setPoolAdmin(await this.owner.address);
    await this.lendingPoolAddressesProvider.setLendingPoolCollateralManager(this.lendingPoolCollateralManager.address);

    // Set the protocol data provider to the 0x1 ID. Use the raw input here vs converting to bytes32 to match Aave configuration
    await this.lendingPoolAddressesProvider.setAddress('0x0100000000000000000000000000000000000000000000000000000000000000', this.protocolDataProvider.address);

    // LendingPoolAddressProvider creates a new proxy contract and sets the passed in address as the implementation.
    // We then fetch the proxy's address and attach it to the contract object, which allows us to use the contract object to call functions on the proxy
    await this.lendingPoolAddressesProvider.setLendingPoolImpl(this.lendingPool.address);
    const proxyPool = await this.lendingPoolAddressesProvider.getLendingPool();
    this.lendingPool = this.lendingPool.attach(proxyPool);

    await this.lendingPoolAddressesProvider.setLendingPoolConfiguratorImpl(this.lendingPoolConfigurator.address);
    const proxyConfigurator = await this.lendingPoolAddressesProvider.getLendingPoolConfigurator();
    this.lendingPoolConfigurator = this.lendingPoolConfigurator.attach(proxyConfigurator);

    this.treasuryAddress = await getRandomAddress(); // Tokens are minted to the treasury, so it can't be zero address
    this.incentivesControllerAddress = ZERO_ADDRESS;

    // set initial asset prices in ETH
    await this.setAssetPriceInOracle(dai, daiPriceInEth);

    // As per Aave's interest rate model, if U < U_optimal, R_t = R_0 + (U_t/U_optimal) * R_slope1, when U_t = 0, R_t = R_0
    // R_0 is the interest rate when utilization is 0 (it's the intercept for the above linear equation)
    // And for higher precision it is expressed in Rays
    const oneRay = BigNumber.from(10).pow(27); // 1e27

    // set initial market rates (R_0)
    await this.setMarketBorrowRate(weth, oneRay.mul(3).div(100));
    await this.setMarketBorrowRate(dai, oneRay.mul(39).div(1000));

    // Deploy and configure WETH reserve
    this.wethReserveTokens = await this.createAndEnableReserve(
      weth,
      'WETH',
      18,
      8000, // base LTV: 80%
      8250, // liquidation threshold: 82.5%
      10500, // liquidation bonus: 105.00%
      1000, // reserve factor: 10%
      true, // enable borrowing on reserve
      true // enable stable debts
    );

    // Deploy and configure DAI reserve
    this.daiReserveTokens = await this.createAndEnableReserve(
      dai,
      'DAI',
      18,
      7500, // base LTV: 75%
      8000, // liquidation threshold: 80%
      10500, // liquidation bonus: 105.00%
      1000, // reserve factor: 10%
      true, // enable borrowing on reserve
      true // enable stable debts
    );
  }

  async createAndEnableReserve(
    underlyingAsset,
    underlyingAssetSymbol,
    underlyingAssetDecimals,
    baseLTV,
    liquidationThreshold,
    liquidationBonus,
    reserveFactor,
    borrowingEnabled,
    stableBorrowingEnabled,
    treasuryAddress = this.treasuryAddress,
    incentivesControllerAddress = this.incentivesControllerAddress,
    interestRateStrategyAddress = this.reserveInterestRateStrategy.address
  ) {
    let aToken = await deployContract('AToken', [], this.owner);
    let stableDebtToken = await deployContract('StableDebtToken', [], this.owner);
    let variableDebtToken = await deployContract('VariableDebtToken', [], this.owner);

    // init reserve
    await this.lendingPoolConfigurator.batchInitReserve([
      {
        aTokenImpl: aToken.address,
        stableDebtTokenImpl: stableDebtToken.address,
        variableDebtTokenImpl: variableDebtToken.address,
        underlyingAssetDecimals: underlyingAssetDecimals,
        interestRateStrategyAddress: interestRateStrategyAddress,
        underlyingAsset: underlyingAsset,
        treasury: treasuryAddress,
        incentivesController: incentivesControllerAddress,
        underlyingAssetName: underlyingAssetSymbol,
        aTokenName: `Aave interest bearing ${underlyingAssetSymbol}`,
        aTokenSymbol: `a${underlyingAssetSymbol}`,
        variableDebtTokenName: `Aave variable debt bearing ${underlyingAssetSymbol}`,
        variableDebtTokenSymbol: `variableDebt${underlyingAssetSymbol}`,
        stableDebtTokenName: `Aave stable debt bearing ${underlyingAssetSymbol}`,
        stableDebtTokenSymbol: `stableDebt${underlyingAssetSymbol}`,
        params: '0x',
      },
    ]);

    // configure reserve
    await this.lendingPoolConfigurator.configureReserveAsCollateral(underlyingAsset, baseLTV, liquidationThreshold, liquidationBonus);

    if (borrowingEnabled) {
      await this.lendingPoolConfigurator.enableBorrowingOnReserve(underlyingAsset, stableBorrowingEnabled);
    }

    await this.lendingPoolConfigurator.setReserveFactor(underlyingAsset, reserveFactor);

    // LendingPoolConfigurator creates a new proxy contract and sets the passed in address as the implementation.
    // We then fetch the proxy's address and attach it to the contract object, which allows us to use the contract object
    // to call functions on the proxy
    const [aTokenProxy, stableDebtTokenProxy, variableDebtTokenProxy] = await this.protocolDataProvider.getReserveTokensAddresses(underlyingAsset);
    aToken = aToken.attach(aTokenProxy);
    stableDebtToken = stableDebtToken.attach(stableDebtTokenProxy);
    variableDebtToken = variableDebtToken.attach(variableDebtTokenProxy);

    return { aToken, stableDebtToken, variableDebtToken };
  }

  async setAssetPriceInOracle(asset, priceInEth) {
    await this.fallbackOracle.setAssetPrice(asset, priceInEth);
  }

  async setMarketBorrowRate(asset, rate) {
    await this.lendingRateOracle.setMarketBorrowRate(asset, rate);
  }

  getForkedAaveLendingPoolAddressesProvider() {
    return this._deployer.external.getForkedAaveLendingPoolAddressesProvider(dependencies.AAVE_LENDING_POOL_ADDRESSES_PROVIDER[1]);
  }

  getForkedAaveV2ProtocolDataProvider() {
    return this._deployer.external.getForkedAaveV2ProtocolDataProvider(dependencies.AAVE_PROTOCOL_DATA_PROVIDER[1]);
  }
}

module.exports = {
  AaveV2Fixture,
};
