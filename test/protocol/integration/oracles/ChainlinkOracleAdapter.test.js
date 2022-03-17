// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkOracleAdapter', async () => {
  const [owner] = await getSigners();
  const price = BigNumber.from(1000);
  const expectedPrice = price.mul(BigNumber.from(10).pow(18));
  const BTC = await getRandomAddress();
  const USD = await getRandomAddress();

  let baseAsset;
  let quotaAsset;
  let decimals;
  let chainlinkFeedRegistryMock;
  let chainlinkSerialOracleAdapter;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    chainlinkFeedRegistryMock = await deployContract('ChainlinkFeedRegistryMock', [], owner);
    chainlinkSerialOracleAdapter = await deployContract('ChainlinkOracleAdapter', [chainlinkFeedRegistryMock.address], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('getFeedRegistry', async () => {
    it('should return the correct registry address', async () => {
      expect(await chainlinkSerialOracleAdapter.getFeedRegistry()).eq(chainlinkFeedRegistryMock.address);
    });
  });

  describe('getPrice', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      baseAsset = BTC;
      quotaAsset = USD;
      decimals = 18;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function getPrice() {
      const priceFeedMock = await deployContract('ChainlinkPriceFeedMock', [price, decimals], owner);
      await chainlinkFeedRegistryMock.setFeed(baseAsset, quotaAsset, priceFeedMock.address);

      return chainlinkSerialOracleAdapter.getPrice(baseAsset, quotaAsset);
    }

    for (let i = 0; i <= 18; i++) {
      it(`when decimals is ${i}`, async () => {
        decimals = i;
        const { found, price } = await getPrice();
        expect(found).is.true;
        expect(price).eq(expectedPrice);
      });
    }

    it(`should return false when base asset is wrong`, async () => {
      baseAsset = await getRandomAddress();
      const { found } = await getPrice();
      expect(found).is.true;
    });

    it(`should return false when quota asset is wrong`, async () => {
      quotaAsset = await getRandomAddress();
      const { found } = await getPrice();
      expect(found).is.true;
    });
  });
});
