// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { compareArray } = require('../helpers/arrayUtil');
const { getSigners } = require('../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');
const { PRECISE_UNIT, ZERO_ADDRESS } = require('../helpers/constants');

function inverse(number) {
  return PRECISE_UNIT.mul(PRECISE_UNIT).div(number);
}

describe('contract PriceOracle', async () => {
  const [owner, wrappedETH, wrappedBTC, usdc, adapterAsset, randomAsset, newOracle, attacker] = getSigners();
  const masterQuoteAsset = wrappedETH.address;
  const assetOnes = [wrappedETH.address, wrappedETH.address];
  const assetTwos = [usdc.address, wrappedBTC.address];
  const initialEthValue = ethToWei(235);
  const initialEthBtcValue = ethToWei(0.025);
  const adapterDummyPrice = ethToWei(5);

  let controller;
  let ethUsdcOracle;
  let ethBtcOracle;
  let masterOracle;
  let oracles;
  let oracleAdapter;
  let oracleAdapters;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    const modules = [owner.address];

    ethUsdcOracle = await deployContract('OracleMock', [initialEthValue], owner);
    ethBtcOracle = await deployContract('OracleMock', [initialEthBtcValue], owner);
    const adapter = await deployContract('OracleAdapterMock', [adapterAsset.address, adapterDummyPrice], owner);
    controller = await deployContract('Controller', [owner.address], owner);

    await controller.initialize([], modules, [], []);

    oracleAdapter = adapter.address;
    oracleAdapters = [oracleAdapter];
    oracles = [ethUsdcOracle.address, ethBtcOracle.address];

    masterOracle = await deployContract('PriceOracle', [controller.address, masterQuoteAsset, oracleAdapters, assetOnes, assetTwos, oracles], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should have the correct controller address', async () => {
      const result = await masterOracle.getController();
      expect(result).eq(controller.address);
    });

    it('should have the correct masterQuoteAsset address', async () => {
      const result = await masterOracle.getMasterQuoteAsset();
      expect(result).eq(masterQuoteAsset);
    });

    it('should have the correct oracle adapters', async () => {
      const result = await masterOracle.getAdapters();
      expect(compareArray(result, oracleAdapters)).is.true;
    });

    it('should have the oracles mapped correctly', async () => {
      const oracleOne = await masterOracle.getOracle(assetOnes[0], assetTwos[0]);
      const oracleTwo = await masterOracle.getOracle(assetOnes[1], assetTwos[1]);
      expect(oracleOne).eq(oracles[0]);
      expect(oracleTwo).eq(oracles[1]);
    });

    it('should revert when the assetOnes and assetTwos arrays are different lengths', async () => {
      await expect(
        deployContract('PriceOracle', [controller.address, masterQuoteAsset, oracleAdapters, [wrappedETH.address], assetTwos, oracles], owner)
      ).revertedWith('PO0a');
    });

    it('should revert when the assetTwos and oracles arrays are different lengths', async () => {
      await expect(
        deployContract('PriceOracle', [controller.address, masterQuoteAsset, oracleAdapters, assetOnes, assetTwos, [ethUsdcOracle.address]], owner)
      ).revertedWith('PO0b');
    });
  });

  describe('getPrice', async () => {
    const asset1 = wrappedETH.address;
    const asset2 = usdc.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should return the price', async () => {
      const result = await masterOracle.getPrice(asset1, asset2);
      const expected = await ethUsdcOracle.read();
      expect(result).eq(expected);
    });

    it('should return inverse price when an inverse price is requested', async () => {
      const result = await masterOracle.getPrice(asset2, asset1);
      const expected = inverse(initialEthValue);
      expect(result).eq(expected);
    });

    it('should return price computed with two oracles when the master quote asset must be used', async () => {
      const result = await masterOracle.getPrice(wrappedBTC.address, usdc.address);
      const expected = inverse(initialEthBtcValue).mul(PRECISE_UNIT).div(inverse(initialEthValue));
      expect(result).eq(expected);
    });

    it('should return price computed with two oracles when the master quote asset must be used', async () => {
      const result = await masterOracle.getPrice(usdc.address, wrappedBTC.address);
      const expected = inverse(initialEthValue).mul(PRECISE_UNIT).div(inverse(initialEthBtcValue));
      expect(result).eq(expected);
    });

    it('should return price computed by adapter when the price is on an adapter', async () => {
      const result = await masterOracle.getPrice(adapterAsset.address, usdc.address);
      expect(result).eq(adapterDummyPrice);
    });

    it('should revert when there is no price for the asset pair', async () => {
      await expect(masterOracle.getPrice(randomAsset.address, usdc.address)).revertedWith('PO1c');
    });
  });

  describe('editPair', async () => {
    const asset1 = wrappedETH.address;
    const asset2 = usdc.address;
    const oracle = newOracle.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should replace the old oracle', async () => {
      await masterOracle.editPair(asset1, asset2, oracle);
      const result = await masterOracle.getOracle(asset1, asset2);
      expect(result).eq(oracle);
    });

    it('should emit an EditPair event', async () => {
      await expect(masterOracle.editPair(asset1, asset2, oracle)).emit(masterOracle, 'EditPair').withArgs(asset1, asset2, oracle);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).editPair(asset1, asset2, oracle)).revertedWith('PO7');
    });

    it('should revert when the asset pair has no oracle', async () => {
      await expect(masterOracle.editPair(randomAsset.address, usdc.address, oracle)).revertedWith('PO3');
    });
  });

  describe('addPair', async () => {
    const asset1 = randomAsset.address;
    const asset2 = usdc.address;
    const oracle = newOracle.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).addPair(asset1, asset2, oracle)).revertedWith('PO7');
    });

    it('should return zero address before create the new oracle', async () => {
      let result = await masterOracle.getOracle(asset1, asset2);
      expect(result).eq(ZERO_ADDRESS);
    });

    it('should emit an AddPair event', async () => {
      await expect(masterOracle.addPair(asset1, asset2, oracle)).emit(masterOracle, 'AddPair').withArgs(asset1, asset2, oracle);
    });

    it('should return correct oracle address after create the new oracle', async () => {
      const result = await masterOracle.getOracle(asset1, asset2);
      expect(result).eq(oracle);
    });

    it('should revert when the asset pair already has an oracle', async () => {
      await expect(masterOracle.addPair(asset1, asset2, oracle)).revertedWith('PO2');
    });
  });

  describe('removePair', async () => {
    const asset1 = wrappedETH.address;
    const asset2 = usdc.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).removePair(asset1, asset2)).revertedWith('PO7');
    });

    it('should revert when the asset pair has no oracle', async () => {
      await expect(masterOracle.removePair(randomAsset.address, asset2)).revertedWith('PO4');
    });

    it('should emit an RemovePair event', async () => {
      const oldOracle = await masterOracle.getOracle(asset1, asset2);
      await expect(masterOracle.removePair(asset1, asset2)).emit(masterOracle, 'RemovePair').withArgs(asset1, asset2, oldOracle);
    });

    it('should return zero address after remove pair', async () => {
      const result = await masterOracle.getOracle(asset1, asset2);
      expect(result).eq(ZERO_ADDRESS);
    });
  });

  describe('addAdapter', async () => {
    const adapter = randomAsset.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).addAdapter(adapter)).revertedWith('PO7');
    });

    it('should emit an AddAdapter event', async () => {
      await expect(masterOracle.addAdapter(adapter)).emit(masterOracle, 'AddAdapter').withArgs(adapter);
    });

    it('should in adapter list after add an adapter', async () => {
      const adapters = await masterOracle.getAdapters();
      expect(adapters).contain(adapter);
    });

    it('should revert when the adapter already exists', async () => {
      await expect(masterOracle.addAdapter(adapter)).revertedWith('PO5');
    });
  });

  describe('removeAdapter', async () => {
    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should in adapter list before remove an adapter', async () => {
      const adapters = await masterOracle.getAdapters();
      expect(adapters).contain(oracleAdapter);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).removeAdapter(oracleAdapter)).revertedWith('PO7');
    });

    it('should emit an RemoveAdapter event', async () => {
      await expect(masterOracle.removeAdapter(oracleAdapter)).emit(masterOracle, 'RemoveAdapter').withArgs(oracleAdapter);
    });

    it('should not in adapter list after remove an adapter', async () => {
      const adapters = await masterOracle.getAdapters();
      expect(adapters).not.contain(oracleAdapter);
    });

    it('should revert when the adapter does not exist', async () => {
      await expect(masterOracle.removeAdapter(randomAsset.address)).revertedWith('PO6');
    });
  });

  describe('editMasterQuoteAsset', async () => {
    const newMasterQuoteAsset = usdc.address;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should return correct asset before change the master quote asset', async () => {
      const result = await masterOracle.getMasterQuoteAsset();
      expect(result).eq(masterQuoteAsset);
    });

    it('should revert when the caller is not the owner', async () => {
      await expect(masterOracle.connect(attacker).editMasterQuoteAsset(newMasterQuoteAsset)).revertedWith('PO7');
    });

    it('should emit an EditMasterQuoteAsset event', async () => {
      await expect(masterOracle.editMasterQuoteAsset(newMasterQuoteAsset)).emit(masterOracle, 'EditMasterQuoteAsset').withArgs(newMasterQuoteAsset);
    });

    it('should return correct asset after change the master quote asset', async () => {
      const result = await masterOracle.getMasterQuoteAsset();
      expect(result).eq(newMasterQuoteAsset);
    });
  });
});
