// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { BigNumber } = ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkOracle', async () => {
  const [owner] = await getSigners();
  const name = 'TEST/USD';
  const price = 1000;
  const expectedPrice = BigNumber.from(10).pow(18).mul(price);

  let decimals;
  let oracle;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    let priceFeedAddress;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      decimals = 18;
      const priceFeedMock = await deployContract('ChainlinkPriceFeedMock', [price, decimals], owner);
      priceFeedAddress = priceFeedMock.address;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function createOracle() {
      return deployContract('ChainlinkOracle', [name, priceFeedAddress], owner);
    }

    it('should reverted when priceFeed is invalid', async () => {
      priceFeedAddress = await getRandomAddress();
      await expect(createOracle()).reverted;
    });

    it('should return the correct name', async () => {
      oracle = await createOracle();
      const result = await oracle.getName();
      expect(result).eq(name);
    });

    it('should return the correct getPriceFeed', async () => {
      oracle = await createOracle();
      const result = await oracle.getPriceFeed();
      expect(result).eq(priceFeedAddress);
    });
  });

  describe('read from ChainlinkPriceFeedMock', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function read() {
      const priceFeedMock = await deployContract('ChainlinkPriceFeedMock', [price, decimals], owner);
      oracle = await deployContract('ChainlinkOracle', [name, priceFeedMock.address], owner);
      return oracle.read();
    }

    for (let i = 0; i <= 18; i += 2) {
      it(`when decimals is ${i}`, async () => {
        decimals = i;
        const result = await read();
        expect(result).eq(expectedPrice);
      });
    }
  });

  describe('read from ChainlinkAggregatorMock', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function read() {
      const priceFeedMock = await deployContract('ChainlinkAggregatorMock', [decimals], owner);
      await priceFeedMock.setLatestAnswer(ethers.utils.parseUnits(`${price}`, decimals));
      oracle = await deployContract('ChainlinkOracle', [name, priceFeedMock.address], owner);
      return oracle.read();
    }

    for (let i = 0; i <= 18; i += 2) {
      it(`when decimals is ${i}`, async () => {
        decimals = i;
        const result = await read();
        expect(result).eq(expectedPrice);
      });
    }
  });
});
