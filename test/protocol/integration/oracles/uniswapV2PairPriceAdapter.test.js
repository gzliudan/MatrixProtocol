// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners } = require('../../../helpers/accountUtil');
const { ethToWei, btcToWei } = require('../../../helpers/unitUtil');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { UniswapFixture } = require('../../../fixtures/uniswapFixture');
const { preciseMul, preciseDiv } = require('../../../helpers/mathUtil');
const { ZERO_ADDRESS, ZERO, MAX_UINT_256 } = require('../../../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract UniswapV2PairPriceAdapter', () => {
  const [owner, protocolFeeRecipient, attacker] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const uniswapFixture = new UniswapFixture(owner);

  let caller;
  let uniswapPriceAdapter;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
    await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);

    // Add owner as module to read prices
    await systemFixture.controller.addModule(owner.address);

    uniswapPriceAdapter = await deployContract('UniswapV2PairPriceAdapter', [systemFixture.priceOracle.address]);
    await uniswapPriceAdapter.addPools([uniswapFixture.wethDaiPool.address, uniswapFixture.wethWbtcPool.address]);

    await uniswapPriceAdapter.addQuoteAsset(systemFixture.usdc.address);

    await systemFixture.controller.addResource(uniswapPriceAdapter.address, 3);

    await systemFixture.priceOracle.addAdapter(uniswapPriceAdapter.address);

    // Approve
    await systemFixture.weth.approve(uniswapFixture.router.address, MAX_UINT_256);
    await systemFixture.wbtc.approve(uniswapFixture.router.address, MAX_UINT_256);
    await systemFixture.dai.approve(uniswapFixture.router.address, MAX_UINT_256);

    // add liquidity to pools
    await uniswapFixture.router.addLiquidity(
      systemFixture.weth.address,
      systemFixture.wbtc.address,
      ethToWei(40),
      btcToWei(1),
      ethToWei(40),
      btcToWei(1),
      owner.address,
      MAX_UINT_256
    );

    await uniswapFixture.router.addLiquidity(
      systemFixture.weth.address,
      systemFixture.dai.address,
      ethToWei(10),
      ethToWei(2300),
      ethToWei(10),
      ethToWei(2300),
      owner.address,
      MAX_UINT_256
    );
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    let uniswapPools;

    // let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      uniswapPools = [uniswapFixture.wethDaiPool.address, uniswapFixture.wethWbtcPool.address];
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function createUniswapV2PairPriceAdapter() {
      const priceAdapter = await deployContract('UniswapV2PairPriceAdapter', [systemFixture.priceOracle.address], owner);
      await priceAdapter.addPools(uniswapPools);
      return priceAdapter;
    }

    it('should have the correct priceOracle address', async () => {
      const priceAdapter = await createUniswapV2PairPriceAdapter();
      const priceOracle = await priceAdapter.getPriceOracle();
      expect(priceOracle).eq(systemFixture.priceOracle.address);
    });

    it('should have the correct Uniswap pools array', async () => {
      const priceAdapter = await createUniswapV2PairPriceAdapter();
      const actualAllowedPools = await priceAdapter.getAllowedUniswapPools();
      expect(JSON.stringify(actualAllowedPools)).eq(JSON.stringify(uniswapPools));
    });

    it('should have the correct Uniswap pool 1 settings', async () => {
      const priceAdapter = await createUniswapV2PairPriceAdapter();
      const actualWethDaiPoolSetting = await priceAdapter.getUniswapPoolSetting(uniswapPools[0]);
      const [expectedTokenOne, expectedTokenTwo] = uniswapFixture.getTokenOrder(systemFixture.weth.address, systemFixture.dai.address);

      expect(actualWethDaiPoolSetting.token1).eq(expectedTokenOne);
      expect(actualWethDaiPoolSetting.token2).eq(expectedTokenTwo);
      expect(actualWethDaiPoolSetting.token1BaseUnit).eq(ethToWei(1));
      expect(actualWethDaiPoolSetting.token1BaseUnit).eq(ethToWei(1));
      expect(actualWethDaiPoolSetting.isValid).is.true;
    });

    it('should have the correct Uniswap pool 2 settings', async () => {
      const priceAdapter = await createUniswapV2PairPriceAdapter();
      const actualWethWbtcPoolSetting = await priceAdapter.getUniswapPoolSetting(uniswapPools[1]);
      const [expectedTokenOne, expectedTokenTwo] = uniswapFixture.getTokenOrder(systemFixture.weth.address, systemFixture.wbtc.address);
      const expectedTokenOneBaseUnit = expectedTokenOne === systemFixture.weth.address ? ethToWei(1) : btcToWei(1);
      const expectedTokenTwoBaseUnit = expectedTokenTwo === systemFixture.weth.address ? ethToWei(1) : btcToWei(1);

      expect(actualWethWbtcPoolSetting.token1).eq(expectedTokenOne);
      expect(actualWethWbtcPoolSetting.token2).eq(expectedTokenTwo);
      expect(actualWethWbtcPoolSetting.token1BaseUnit).eq(expectedTokenOneBaseUnit);
      expect(actualWethWbtcPoolSetting.token2BaseUnit).eq(expectedTokenTwoBaseUnit);
      expect(actualWethWbtcPoolSetting.isValid).is.true;
    });

    it('should revert when passed uniswap pool address is not unique', async () => {
      uniswapPools = [uniswapFixture.wethDaiPool.address, uniswapFixture.wethDaiPool.address];
      await expect(createUniswapV2PairPriceAdapter()).revertedWith('UPPA2');
    });
  });

  describe('getPrice', () => {
    let asset1;
    let asset2;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    context('when a Uniswap pool is the base asset', async () => {
      beforeEach(async () => {
        caller = owner;
        asset1 = uniswapFixture.wethDaiPool.address;
        asset2 = systemFixture.usdc.address;
      });

      async function getPrice() {
        return uniswapPriceAdapter.connect(caller).getPrice(asset1, asset2);
      }

      it('should return the price', async () => {
        const { found, price } = await getPrice();

        // Get oracle prices
        const ethUsdPrice = await systemFixture.ethUsdOracle.read();
        const daiUsdPrice = await systemFixture.daiUsdOracle.read();
        const usdUsdPrice = await systemFixture.usdUsdOracle.read();

        // Get uniswap reserve info
        const wethBaseUnits = ethToWei(1);
        const daiBaseUnits = ethToWei(1);
        const poolTotalSupply = await uniswapFixture.wethDaiPool.totalSupply();
        const wethReserves = await systemFixture.weth.balanceOf(uniswapFixture.wethDaiPool.address);
        const daiReserves = await systemFixture.dai.balanceOf(uniswapFixture.wethDaiPool.address);

        // Calculate normalized units
        const normalizedWethReserves = preciseDiv(wethReserves, wethBaseUnits);
        const normalizedDaiReserves = preciseDiv(daiReserves, daiBaseUnits);

        // Get expected price
        const poolMarketCap = preciseMul(normalizedWethReserves, ethUsdPrice).add(preciseMul(normalizedDaiReserves, daiUsdPrice));
        const poolPriceToMaster = preciseDiv(poolMarketCap, poolTotalSupply);
        const expectedPrice = preciseDiv(poolPriceToMaster, usdUsdPrice);

        expect(found).is.true;
        expect(price).eq(expectedPrice);
      });

      // it('should revert when the caller is not a system contract', async () => {
      //   caller = attacker;
      //   await expect(getPrice()).revertedWith('UPPA3');
      // });

      it('should return false and 0 when both base and quote asset are not Uniswap pools', async () => {
        asset1 = systemFixture.dai.address;
        const returnedValue = await getPrice();
        expect(returnedValue[0]).is.false;
        expect(returnedValue[1]).eq(ZERO);
      });
    });

    context('when a Uniswap pool is the quote asset', async () => {
      beforeEach(async () => {
        caller = owner;
        asset1 = systemFixture.dai.address;
        asset2 = uniswapFixture.wethWbtcPool.address;
      });

      async function getPrice() {
        return uniswapPriceAdapter.connect(caller).getPrice(asset1, asset2);
      }

      it('should return the price', async () => {
        const { found, price } = await getPrice();

        // Get oracle prices
        const ethUsdPrice = await systemFixture.ethUsdOracle.read();
        const wbtcUsdPrice = await systemFixture.btcUsdOracle.read();
        const usdUsdPrice = await systemFixture.usdUsdOracle.read();

        // Get uniswap reserve info
        const wethBaseUnits = ethToWei(1);
        const wbtcBaseUnits = btcToWei(1);
        const poolTotalSupply = await uniswapFixture.wethWbtcPool.totalSupply();
        const wethReserves = await systemFixture.weth.balanceOf(uniswapFixture.wethWbtcPool.address);
        const wbtcReserves = await systemFixture.wbtc.balanceOf(uniswapFixture.wethWbtcPool.address);

        // Calculate normalized units
        const normalizedWethReserves = preciseDiv(wethReserves, wethBaseUnits);
        const normalizedWbtcReserves = preciseDiv(wbtcReserves, wbtcBaseUnits);

        // Get expected price
        const poolMarketCap = preciseMul(normalizedWethReserves, ethUsdPrice).add(preciseMul(normalizedWbtcReserves, wbtcUsdPrice));
        const poolPriceToMaster = preciseDiv(poolMarketCap, poolTotalSupply);
        const expectedPrice = preciseDiv(usdUsdPrice, poolPriceToMaster);

        expect(found).is.true;
        expect(price).eq(expectedPrice);
      });
    });

    context('when Uniswap pools are both the base and quote asset', async () => {
      beforeEach(async () => {
        asset1 = uniswapFixture.wethDaiPool.address;
        asset2 = uniswapFixture.wethWbtcPool.address;
        caller = owner;
      });

      async function getPrice() {
        return uniswapPriceAdapter.connect(caller).getPrice(asset1, asset2);
      }

      it('should return the price', async () => {
        const { found, price } = await getPrice();

        // Get oracle prices
        const ethUsdPrice = await systemFixture.ethUsdOracle.read();
        const wbtcUsdPrice = await systemFixture.btcUsdOracle.read();
        const daiUsdPrice = await systemFixture.usdUsdOracle.read();

        const wethBaseUnits = ethToWei(1);
        const wbtcBaseUnits = btcToWei(1);
        const daiBaseUnits = ethToWei(1);

        // Get uniswap pool one reserve info
        const wethReservesOne = await systemFixture.weth.balanceOf(uniswapFixture.wethDaiPool.address);
        const daiReservesOne = await systemFixture.dai.balanceOf(uniswapFixture.wethDaiPool.address);
        const poolTotalSupplyOne = await uniswapFixture.wethDaiPool.totalSupply();

        // Calculate normalized units for pool one
        const normalizedWethReservesOne = preciseDiv(wethReservesOne, wethBaseUnits);
        const normalizedDaiReservesOne = preciseDiv(daiReservesOne, daiBaseUnits);

        // Get price for pool one
        const poolMarketCapOne = preciseMul(normalizedWethReservesOne, ethUsdPrice).add(preciseMul(normalizedDaiReservesOne, daiUsdPrice));
        const poolPriceToMasterOne = preciseDiv(poolMarketCapOne, poolTotalSupplyOne);

        // Get uniswap pool two reserve info
        const wethReservesTwo = await systemFixture.weth.balanceOf(uniswapFixture.wethWbtcPool.address);
        const wbtcReservesTwo = await systemFixture.wbtc.balanceOf(uniswapFixture.wethWbtcPool.address);
        const poolTotalSupplyTwo = await uniswapFixture.wethWbtcPool.totalSupply();

        // Calculate normalized units for pool two
        const normalizedWethReservesTwo = preciseDiv(wethReservesTwo, wethBaseUnits);
        const normalizedWbtcReservesTwo = preciseDiv(wbtcReservesTwo, wbtcBaseUnits);

        // Get price for pool two
        const poolMarketCapTwo = preciseMul(normalizedWethReservesTwo, ethUsdPrice).add(preciseMul(normalizedWbtcReservesTwo, wbtcUsdPrice));
        const poolPriceToMasterTwo = preciseDiv(poolMarketCapTwo, poolTotalSupplyTwo);

        const expectedPrice = preciseDiv(poolPriceToMasterOne, poolPriceToMasterTwo);

        expect(found).is.true;
        expect(price).eq(expectedPrice);
      });
    });
  });

  describe('addPool', () => {
    let poolAddress;
    let token1Address;
    let token2Address;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      const token1 = await deployContract('Erc20Mock', ['Mock1', 'M1', 18], this.owner);
      await token1.mint(owner.address, ethToWei(1000000000));
      token1Address = token1.address;

      const token2 = await deployContract('Erc20Mock', ['Mock2', 'M2', 8], this.owner);
      await token2.mint(owner.address, ethToWei(1000000000));
      token2Address = token2.address;

      const uniswapPool = await uniswapFixture.createNewPair(token1Address, token2Address);
      poolAddress = uniswapPool.address;
      caller = owner;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function addPool() {
      return uniswapPriceAdapter.connect(caller).addPool(poolAddress);
    }

    it('adds the address to the pools list', async () => {
      let existingPools = await uniswapPriceAdapter.getAllowedUniswapPools();
      await addPool();
      const newPools = await uniswapPriceAdapter.getAllowedUniswapPools();
      existingPools = existingPools.concat(poolAddress);
      expect(newPools).deep.equal(existingPools);
    });

    it('adds the pool settings to the allowed pools mapping', async () => {
      await addPool();

      const newSetting = await uniswapPriceAdapter.getUniswapPoolSetting(poolAddress);
      const [expectedTokenOne, expectedTokenTwo] = uniswapFixture.getTokenOrder(token1Address, token2Address);
      const [expectedTokenOneDecimals, expectedTokenTwoDecimals] = expectedTokenOne == token1Address ? [ethToWei(1), btcToWei(1)] : [btcToWei(1), ethToWei(1)];

      expect(newSetting.token1).eq(expectedTokenOne);
      expect(newSetting.token2).eq(expectedTokenTwo);
      expect(newSetting.token1BaseUnit).eq(expectedTokenOneDecimals);
      expect(newSetting.token2BaseUnit).eq(expectedTokenTwoDecimals);
      expect(newSetting.isValid).is.true;
    });

    it('should revert when someone other than the owner tries to add an address', async () => {
      caller = attacker;
      await expect(addPool()).reverted;
    });

    it('should revert when the address is already in the allowList', async () => {
      poolAddress = uniswapFixture.wethWbtcPool.address;
      await expect(addPool()).revertedWith('UPPA2');
    });
  });

  describe('removePair', () => {
    let poolAddress;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      const token1 = await deployContract('Erc20Mock', ['Mock1', 'M1', 18], this.owner);
      await token1.mint(owner.address, ethToWei(1000000000));

      const token2 = await deployContract('Erc20Mock', ['Mock2', 'M2', 18], this.owner);
      await token2.mint(owner.address, ethToWei(1000000000));

      const uniswapPool = await uniswapFixture.createNewPair(token1.address, token2.address);
      await uniswapPriceAdapter.addPool(uniswapPool.address);

      poolAddress = uniswapPool.address;
      caller = owner;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function removePool() {
      return uniswapPriceAdapter.connect(caller).removePool(poolAddress);
    }

    it('removes the address from the addresses list', async () => {
      await removePool();

      const newAddresses = await uniswapPriceAdapter.getAllowedUniswapPools();
      const addressIndex = newAddresses.indexOf(poolAddress);
      expect(addressIndex).eq(-1);
    });

    it('updates the address in the settings mapping to null', async () => {
      await removePool();
      const poolSetting = await uniswapPriceAdapter.getUniswapPoolSetting(poolAddress);

      expect(poolSetting.token1).eq(ZERO_ADDRESS);
      expect(poolSetting.token2).eq(ZERO_ADDRESS);
      expect(poolSetting.token1BaseUnit).eq(ZERO);
      expect(poolSetting.token2BaseUnit).eq(ZERO);
      expect(poolSetting.isValid).is.false;
    });

    it('should revert when someone other than the owner tries to remove an address', async () => {
      caller = attacker;
      await expect(removePool()).reverted;
    });

    it('should revert when the address is not in the allowList', async () => {
      poolAddress = owner.address;
      await expect(removePool()).revertedWith('UPPA3');
    });
  });
});
