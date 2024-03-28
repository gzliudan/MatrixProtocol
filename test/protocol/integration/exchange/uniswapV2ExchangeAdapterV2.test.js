// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { ethers } = require('hardhat');

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners } = require('../../../helpers/accountUtil');
const { ethToWei, btcToWei } = require('../../../helpers/unitUtil');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { UniswapFixture } = require('../../../fixtures/uniswapFixture');
const { snapshotBlockchain, revertBlockchain, getLastBlockTimestamp } = require('../../../helpers/evmUtil.js');
const { ZERO, EMPTY_BYTES } = require('../../../helpers/constants');

describe('contract UniswapV2ExchangeAdapterV2', function () {
  const [owner, protocolFeeRecipient, matrixTokenMock] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const uniswapFixture = new UniswapFixture(owner);

  let uniswapV2ExchangeAdapterV2;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
    await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
    uniswapV2ExchangeAdapterV2 = await deployContract('UniswapV2ExchangeAdapterV2', [uniswapFixture.router.address], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getSpender', function () {
    it('should return the correct spender address', async function () {
      const spender = await uniswapV2ExchangeAdapterV2.getSpender();
      expect(spender).eq(uniswapFixture.router.address);
    });
  });

  describe('getExchangeData', function () {
    it('should return the correct data', async function () {
      const shouldSwapExactTokensForTokens = true;
      const tradePath = [systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address];
      const uniswapData = await uniswapV2ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokensForTokens);
      const expectedData = ethers.utils.defaultAbiCoder.encode(['address[]', 'bool'], [tradePath, shouldSwapExactTokensForTokens]);

      expect(uniswapData).eq(expectedData);
    });
  });

  describe('generateDataParam', function () {
    let srcToken;
    let destToken;
    let isFixIn;

    beforeEach(async function () {
      srcToken = systemFixture.wbtc.address;
      destToken = systemFixture.weth.address;
    });

    async function generateDataParam() {
      return await uniswapV2ExchangeAdapterV2.generateDataParam(srcToken, destToken, isFixIn);
    }

    describe('when boolean fixed input amount is true', function () {
      it('should return the correct trade calldata', async function () {
        isFixIn = true;
        const dataParam = await generateDataParam();

        const path = [srcToken, destToken];
        const expectedDataParam = ethers.utils.defaultAbiCoder.encode(['address[]', 'bool'], [path, isFixIn]);

        expect(JSON.stringify(dataParam)).eq(JSON.stringify(expectedDataParam));
      });
    });

    describe('when boolean fixed input amount is false', function () {
      it('should return the correct trade calldata', async function () {
        isFixIn = false;
        const dataParam = await generateDataParam();

        const path = [srcToken, destToken];
        const expectedDataParam = ethers.utils.defaultAbiCoder.encode(['address[]', 'bool'], [path, isFixIn]);

        expect(JSON.stringify(dataParam)).eq(JSON.stringify(expectedDataParam));
      });
    });
  });

  describe('getTradeCalldata', function () {
    const srcQuantity = btcToWei(1); // Trade 1 WBTC;
    const minDestQuantity = ethToWei(30000); // Receive at least 30k DAI;

    let srcToken;
    let destToken;
    let dataBytes;
    let matrixTokenAddress;

    beforeEach(async function () {
      dataBytes = EMPTY_BYTES;
      srcToken = systemFixture.wbtc.address; // WBTC Address
      destToken = systemFixture.dai.address; // DAI Address
      matrixTokenAddress = matrixTokenMock.address;
    });

    async function getTradeCalldata() {
      return await uniswapV2ExchangeAdapterV2.getTradeCalldata(srcToken, destToken, matrixTokenAddress, srcQuantity, minDestQuantity, dataBytes);
    }

    describe('when swap exact tokens for tokens', function () {
      it('should return the correct trade calldata', async function () {
        const shouldSwapExactTokensForTokens = true;
        const path = [srcToken, systemFixture.weth.address, destToken];
        dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]', 'bool'], [path, shouldSwapExactTokensForTokens]);

        const calldata = await getTradeCalldata();

        const callTimestamp = await getLastBlockTimestamp();
        const expectedCallData = uniswapFixture.router.interface.encodeFunctionData('swapExactTokensForTokens', [
          srcQuantity,
          minDestQuantity,
          [srcToken, systemFixture.weth.address, destToken],
          matrixTokenAddress,
          callTimestamp,
        ]);

        expect(JSON.stringify(calldata)).eq(JSON.stringify([uniswapFixture.router.address, ZERO, expectedCallData]));
      });
    });

    describe('when swap tokens for exact tokens', function () {
      it('should return the correct trade calldata', async function () {
        const shouldSwapExactTokensForTokens = false;
        const path = [srcToken, systemFixture.weth.address, destToken];
        dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]', 'bool'], [path, shouldSwapExactTokensForTokens]);

        const calldata = await getTradeCalldata();

        const callTimestamp = await getLastBlockTimestamp();
        const expectedCallData = uniswapFixture.router.interface.encodeFunctionData('swapTokensForExactTokens', [
          minDestQuantity, // Source and destination quantity are flipped for swapTokensForExactTokens
          srcQuantity,
          [srcToken, systemFixture.weth.address, destToken],
          matrixTokenAddress,
          callTimestamp,
        ]);

        expect(JSON.stringify(calldata)).eq(JSON.stringify([uniswapFixture.router.address, ZERO, expectedCallData]));
      });
    });
  });
});
