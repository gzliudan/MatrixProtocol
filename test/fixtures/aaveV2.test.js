// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { SystemFixture } = require('./systemFixture');
const { AaveV2Fixture } = require('./aaveV2Fixture');
const { getSigners } = require('../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('AaveV2Fixture', async () => {
  const [owner, protocolFeeRecipient] = await getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const aaveV2Fixture = new AaveV2Fixture(owner);

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('init', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function init() {
      await aaveV2Fixture.init(systemFixture.weth.address, systemFixture.dai.address);
    }

    it('should deploy all contracts and set their addresses in the LendingPoolAddressProvider', async () => {
      await init();

      const addressProvider = aaveV2Fixture.lendingPoolAddressesProvider;
      const lendingPoolAddress = await addressProvider.getLendingPool();
      const lendingPoolConfiuratorAddress = await addressProvider.getLendingPoolConfigurator();
      const lendingPoolCollateralManager = await addressProvider.getLendingPoolCollateralManager();
      const protocolDataProvider = await addressProvider.getAddress('0x0100000000000000000000000000000000000000000000000000000000000000');

      expect(lendingPoolAddress).eq(aaveV2Fixture.lendingPool.address);
      expect(lendingPoolConfiuratorAddress).eq(aaveV2Fixture.lendingPoolConfigurator.address);
      expect(lendingPoolCollateralManager).eq(aaveV2Fixture.lendingPoolCollateralManager.address);
      expect(protocolDataProvider).eq(aaveV2Fixture.protocolDataProvider.address);
    });

    it('should set initial asset prices and market rates', async () => {
      const oneRay = BigNumber.from(10).pow(27); // 1e27

      await init();

      const wethPriceInEth = await aaveV2Fixture.priceOracle.getAssetPrice(systemFixture.weth.address);
      const daiPriceInEth = await aaveV2Fixture.priceOracle.getAssetPrice(systemFixture.dai.address);
      const wethMarketBorrowRate = await aaveV2Fixture.lendingRateOracle.getMarketBorrowRate(systemFixture.weth.address);
      const daiMarketBorrowRate = await aaveV2Fixture.lendingRateOracle.getMarketBorrowRate(systemFixture.dai.address);

      expect(wethPriceInEth).eq(ethToWei(1));
      expect(daiPriceInEth).eq(ethToWei(0.001));
      expect(wethMarketBorrowRate).eq(oneRay.mul(3).div(100));
      expect(daiMarketBorrowRate).eq(oneRay.mul(39).div(1000));
    });

    it('should deploy WETH reserve with correct configuration', async () => {
      await init();

      const wethReserveTokens = aaveV2Fixture.wethReserveTokens;
      const reservesList = await aaveV2Fixture.lendingPool.getReservesList();
      const tokenAddresses = await aaveV2Fixture.protocolDataProvider.getReserveTokensAddresses(systemFixture.weth.address);
      const config = await aaveV2Fixture.protocolDataProvider.getReserveConfigurationData(systemFixture.weth.address);

      expect(reservesList).contain(systemFixture.weth.address);

      expect(wethReserveTokens.aToken.address).eq(tokenAddresses.aTokenAddress);
      expect(wethReserveTokens.stableDebtToken.address).eq(tokenAddresses.stableDebtTokenAddress);
      expect(wethReserveTokens.variableDebtToken.address).eq(tokenAddresses.variableDebtTokenAddress);

      expect(config.isActive).is.true;
      expect(config.isFrozen).is.false;
      expect(config.decimals).eq(18);
      expect(config.ltv).eq(8000);
      expect(config.liquidationThreshold).eq(8250);
      expect(config.liquidationBonus).eq(10500);
      expect(config.reserveFactor).eq(1000);
      expect(config.borrowingEnabled).is.true;
      expect(config.usageAsCollateralEnabled).is.true;
      expect(config.stableBorrowRateEnabled).is.true;
    });

    it('should deploy DAI reserve with correct configuration', async () => {
      await init();

      const daiReserveTokens = aaveV2Fixture.daiReserveTokens;
      const reservesList = await aaveV2Fixture.lendingPool.getReservesList();
      const tokenAddresses = await aaveV2Fixture.protocolDataProvider.getReserveTokensAddresses(systemFixture.dai.address);
      const config = await aaveV2Fixture.protocolDataProvider.getReserveConfigurationData(systemFixture.dai.address);

      expect(reservesList).contain(systemFixture.dai.address);

      expect(daiReserveTokens.aToken.address).eq(tokenAddresses.aTokenAddress);
      expect(daiReserveTokens.stableDebtToken.address).eq(tokenAddresses.stableDebtTokenAddress);
      expect(daiReserveTokens.variableDebtToken.address).eq(tokenAddresses.variableDebtTokenAddress);

      expect(config.isActive).is.true;
      expect(config.isFrozen).is.false;
      expect(config.decimals).eq(18);
      expect(config.ltv).eq(7500);
      expect(config.liquidationThreshold).eq(8000);
      expect(config.liquidationBonus).eq(10500);
      expect(config.reserveFactor).eq(1000);
      expect(config.borrowingEnabled).is.true;
      expect(config.usageAsCollateralEnabled).is.true;
      expect(config.stableBorrowRateEnabled).is.true;
    });
  });
});
