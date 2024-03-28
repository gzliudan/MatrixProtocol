// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkOracleAdapter', function () {
  const [owner] = getSigners();
  const price = BigNumber.from(1000);
  const expectedPrice = price.mul(BigNumber.from(10).pow(18));
  let BTC;
  let USD;

  let baseAsset;
  let quotaAsset;
  let decimals;
  let chainlinkFeedRegistryMock;
  let chainlinkSerialOracleAdapter;

  let snapshotId;
  before(async function () {
    BTC = await getRandomAddress();
    USD = await getRandomAddress();
    snapshotId = await snapshotBlockchain();

    chainlinkFeedRegistryMock = await deployContract('ChainlinkFeedRegistryMock', [], owner);
    chainlinkSerialOracleAdapter = await deployContract('ChainlinkOracleAdapter', [chainlinkFeedRegistryMock.address], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getFeedRegistry', function () {
    it('should return the correct registry address', async function () {
      expect(await chainlinkSerialOracleAdapter.getFeedRegistry()).eq(chainlinkFeedRegistryMock.address);
    });
  });

  describe('getPrice', function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      baseAsset = BTC;
      quotaAsset = USD;
      decimals = 18;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getPrice() {
      const priceFeedMock = await deployContract('ChainlinkPriceFeedMock', [price, decimals], owner);
      await chainlinkFeedRegistryMock.setFeed(baseAsset, quotaAsset, priceFeedMock.address);

      return chainlinkSerialOracleAdapter.getPrice(baseAsset, quotaAsset);
    }

    for (let i = 0; i <= 18; i++) {
      it(`when decimals is ${i}`, async function () {
        decimals = i;
        const { found, price } = await getPrice();
        expect(found).is.true;
        expect(price).eq(expectedPrice);
      });
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
