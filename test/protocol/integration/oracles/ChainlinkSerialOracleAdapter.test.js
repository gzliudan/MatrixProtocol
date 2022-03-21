// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkSerialOracleAdapter', async () => {
  const [owner] = await getSigners();
  const price1 = BigNumber.from(1000);
  const price2 = BigNumber.from(10);
  const expectedPrice = price1.mul(price2).mul(BigNumber.from(10).pow(18));
  const BTC = await getRandomAddress();
  const ETH = await getRandomAddress();
  const USD = await getRandomAddress();
  const intermediaryAsset = ETH;

  let baseAsset;
  let quotaAsset;
  let decimals1;
  let decimals2;
  let chainlinkFeedRegistryMock;
  let chainlinkSerialOracleAdapter;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    chainlinkFeedRegistryMock = await deployContract('ChainlinkFeedRegistryMock', [], owner);
    chainlinkSerialOracleAdapter = await deployContract('ChainlinkSerialOracleAdapter', [chainlinkFeedRegistryMock.address, intermediaryAsset], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('getFeedRegistry', async () => {
    it('should return the correct registry address', async () => {
      expect(await chainlinkSerialOracleAdapter.getFeedRegistry()).eq(chainlinkFeedRegistryMock.address);
    });
  });

  describe('getIntermediaryAsset', async () => {
    it('should return the correct intermediary asset', async () => {
      expect(await chainlinkSerialOracleAdapter.getIntermediaryAsset()).eq(intermediaryAsset);
    });
  });

  describe('getPrice', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      baseAsset = BTC;
      quotaAsset = USD;
      decimals1 = 18;
      decimals2 = 18;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function getPrice() {
      const priceFeedMock1 = await deployContract('ChainlinkPriceFeedMock', [price1, decimals1], owner);
      await chainlinkFeedRegistryMock.setFeed(baseAsset, intermediaryAsset, priceFeedMock1.address);

      const priceFeedMock2 = await deployContract('ChainlinkPriceFeedMock', [price2, decimals2], owner);
      await chainlinkFeedRegistryMock.setFeed(intermediaryAsset, quotaAsset, priceFeedMock2.address);

      return chainlinkSerialOracleAdapter.getPrice(baseAsset, quotaAsset);
    }

    for (let i = 0; i <= 18; i++) {
      for (let j = 0; j <= 18; j++) {
        it(`when decimals1 is ${i} and decimals2 is ${j}`, async () => {
          decimals1 = i;
          decimals2 = j;
          const { found, price } = await getPrice();
          expect(found).is.true;
          expect(price).eq(expectedPrice);
        });
      }
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
