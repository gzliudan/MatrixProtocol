// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract ChainlinkSerialOracle', () => {
  const [owner] = getSigners();
  const name = 'BTC/ETH/USD';
  const price1 = BigNumber.from(1000);
  const price2 = BigNumber.from(10);
  const expectedPrice = price1.mul(price2).mul(BigNumber.from(10).pow(18));

  let decimals1;
  let decimals2;
  let priceFeedMock1;
  let priceFeedMock2;
  let priceFeed1Address;
  let priceFeed2Address;
  let oracle;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      decimals1 = 18;
      priceFeedMock1 = await deployContract('ChainlinkPriceFeedMock', [price1, decimals1], owner);
      priceFeed1Address = priceFeedMock1.address;

      decimals2 = 18;
      priceFeedMock2 = await deployContract('ChainlinkPriceFeedMock', [price2, decimals2], owner);
      priceFeed2Address = priceFeedMock2.address;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function createOracle() {
      return deployContract('ChainlinkSerialOracle', [name, priceFeed1Address, priceFeed2Address], owner);
    }

    it('should reverted when priceFeed1 is invalid', async () => {
      priceFeed1Address = await getRandomAddress();
      await expect(createOracle()).reverted;
    });

    it('should reverted when priceFeed1 is invalid', async () => {
      priceFeed2Address = await getRandomAddress();
      await expect(createOracle()).reverted;
    });

    it('should return the correct name', async () => {
      oracle = await createOracle();
      const result = await oracle.getName();
      expect(result).eq(name);
    });

    it('should return the correct getPriceFeed1', async () => {
      oracle = await createOracle();
      const priceFeed1 = await oracle.getPriceFeed1();
      expect(priceFeed1).eq(priceFeed1Address);
    });

    it('should return the correct getPriceFeed2', async () => {
      oracle = await createOracle();
      const priceFeed2 = await oracle.getPriceFeed2();
      expect(priceFeed2).eq(priceFeed2Address);
    });
  });

  describe('read', () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function read() {
      priceFeedMock1 = await deployContract('ChainlinkPriceFeedMock', [price1, decimals1], owner);
      priceFeed1Address = priceFeedMock1.address;
      priceFeedMock2 = await deployContract('ChainlinkPriceFeedMock', [price2, decimals2], owner);
      priceFeed2Address = priceFeedMock2.address;
      oracle = await deployContract('ChainlinkSerialOracle', [name, priceFeed1Address, priceFeed2Address], owner);
      return oracle.read();
    }

    for (let i = 0; i <= 18; i++) {
      for (let j = 0; j <= 18; j++) {
        it(`when decimals1 is ${i} and decimals2 is ${j}`, async () => {
          decimals1 = i;
          decimals2 = j;
          const result = await read();
          expect(result).eq(expectedPrice);
        });
      }
    }
  });
});
