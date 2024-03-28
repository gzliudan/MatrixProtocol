// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkSerialOracleAdapter', function () {
  const [owner] = getSigners();
  const price1 = BigNumber.from(1000);
  const price2 = BigNumber.from(10);
  const expectedPrice = price1.mul(price2).mul(BigNumber.from(10).pow(18));
  let BTC;
  let ETH;
  let USD;
  let intermediaryAsset;

  let baseAsset;
  let quotaAsset;
  let decimals1;
  let decimals2;
  let chainlinkFeedRegistryMock;
  let chainlinkSerialOracleAdapter;

  let snapshotId;
  before(async function () {
    BTC = await getRandomAddress();
    ETH = await getRandomAddress();
    USD = await getRandomAddress();
    snapshotId = await snapshotBlockchain();

    intermediaryAsset = ETH;
    chainlinkFeedRegistryMock = await deployContract('ChainlinkFeedRegistryMock', [], owner);
    chainlinkSerialOracleAdapter = await deployContract('ChainlinkSerialOracleAdapter', [chainlinkFeedRegistryMock.address, intermediaryAsset], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getFeedRegistry', function () {
    it('should return the correct registry address', async function () {
      expect(await chainlinkSerialOracleAdapter.getFeedRegistry()).eq(chainlinkFeedRegistryMock.address);
    });
  });

  describe('getIntermediaryAsset', function () {
    it('should return the correct intermediary asset', async function () {
      expect(await chainlinkSerialOracleAdapter.getIntermediaryAsset()).eq(intermediaryAsset);
    });
  });

  describe('getPrice', function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      baseAsset = BTC;
      quotaAsset = USD;
      decimals1 = 18;
      decimals2 = 18;
    });

    afterEach(async function () {
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
        it(`when decimals1 is ${i} and decimals2 is ${j}`, async function () {
          decimals1 = i;
          decimals2 = j;
          const { found, price } = await getPrice();
          expect(found).is.true;
          expect(price).eq(expectedPrice);
        });
      }
    }

    it(`should return false when base asset is wrong`, async function () {
      baseAsset = await getRandomAddress();
      const { found } = await getPrice();
      expect(found).is.true;
    });

    it(`should return false when quota asset is wrong`, async function () {
      quotaAsset = await getRandomAddress();
      const { found } = await getPrice();
      expect(found).is.true;
    });
  });
});
