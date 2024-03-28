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

describe('contract UniswapV2ExchangeAdapter', function () {
  const [owner, protocolFeeRecipient, matrixTokenMock] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const uniswapFixture = new UniswapFixture(owner);

  let uniswapV2ExchangeAdapter;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
    await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
    uniswapV2ExchangeAdapter = await deployContract('UniswapV2ExchangeAdapter', [uniswapFixture.router.address], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getSpender', function () {
    it('should have the correct router address', async function () {
      const actualRouterAddress = await uniswapV2ExchangeAdapter.getSpender();
      expect(actualRouterAddress).eq(uniswapFixture.router.address);
    });
  });

  describe('getTradeCalldata', function () {
    const srcQuantity = btcToWei(1); // Trade 1 WBTC
    const minDestQuantity = ethToWei(30000); // Receive at least 30k DAI

    let srcToken;
    let destToken;
    let pathBytes;
    let matrixTokenAddress;

    beforeEach(async function () {
      srcToken = systemFixture.wbtc.address; // WBTC Address
      destToken = systemFixture.dai.address; // DAI Address
      matrixTokenAddress = matrixTokenMock.address;
    });

    async function getTradeCalldata() {
      return await uniswapV2ExchangeAdapter.getTradeCalldata(srcToken, destToken, matrixTokenAddress, srcQuantity, minDestQuantity, pathBytes);
    }

    it('should return the correct trade calldata when passed direct path', async function () {
      pathBytes = EMPTY_BYTES;
      const calldata = await getTradeCalldata();
      const callTimestamp = await getLastBlockTimestamp();
      const expectedCallData = uniswapFixture.router.interface.encodeFunctionData('swapExactTokensForTokens', [
        srcQuantity,
        minDestQuantity,
        [srcToken, destToken],
        matrixTokenAddress,
        callTimestamp,
      ]);

      expect(JSON.stringify(calldata)).eq(JSON.stringify([uniswapFixture.router.address, ZERO, expectedCallData]));
    });

    it('should return the correct trade calldata when passed in custom path to trade data', async function () {
      const path = [srcToken, systemFixture.weth.address, destToken];
      pathBytes = ethers.utils.defaultAbiCoder.encode(['address[]'], [path]);
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
});
