// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners } = require('../../../helpers/accountUtil');
const { ethToWei, btcToWei } = require('../../../helpers/unitUtil');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');
const { ZERO, MAX_UINT_256, ZERO_ADDRESS, EMPTY_BYTES } = require('../../../helpers/constants');

describe('contract KyberLegacyExchangeAdapter', function () {
  const [owner, protocolFeeRecipient, matrixTokenMock] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const wbtcRate = ethToWei(33); // 1 WBTC = 33 ETH

  let kyberNetworkProxy;
  let kyberLegacyExchangeAdapter;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    // Mock Kyber reserve only allows trading from/to WETH
    kyberNetworkProxy = await deployContract('KyberNetworkProxyMock', [systemFixture.weth.address], owner);
    await kyberNetworkProxy.addToken(systemFixture.wbtc.address, wbtcRate, 8);

    kyberLegacyExchangeAdapter = await deployContract('KyberLegacyExchangeAdapter', [kyberNetworkProxy.address], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getSpender', function () {
    it('should return the correct spender address', async function () {
      const actualKyberAddress = await kyberLegacyExchangeAdapter.getSpender();
      expect(actualKyberAddress).eq(kyberNetworkProxy.address);
    });
  });

  describe('getConversionRates', function () {
    async function getConversionRates() {
      const srcToken = systemFixture.wbtc.address;
      const destToken = systemFixture.weth.address;
      const srcQuantity = ethToWei(1);
      return await kyberLegacyExchangeAdapter.getConversionRates(srcToken, destToken, srcQuantity);
    }

    it('should return the correct exchange rate', async function () {
      const actualRates = await getConversionRates();
      expect(JSON.stringify(actualRates)).eq(JSON.stringify([wbtcRate, wbtcRate]));
    });
  });

  describe('getTradeCalldata', function () {
    const srcQuantity = btcToWei(1); // Trade 1 WBTC
    const minDestQuantity = ethToWei(33); // Receive at least 33 ETH
    const pathBytes = EMPTY_BYTES;

    let srcToken;
    let destToken;
    let matrixTokenAddress;

    beforeEach(async function () {
      srcToken = systemFixture.wbtc.address; // WBTC Address
      destToken = systemFixture.weth.address; // WETH Address
      matrixTokenAddress = matrixTokenMock.address;
    });

    async function getTradeCalldata() {
      return await kyberLegacyExchangeAdapter.getTradeCalldata(srcToken, destToken, matrixTokenAddress, srcQuantity, minDestQuantity, pathBytes);
    }

    it('should return the correct trade calldata', async function () {
      const calldata = await getTradeCalldata();
      const expectedCallData = kyberNetworkProxy.interface.encodeFunctionData('trade', [
        srcToken,
        srcQuantity,
        destToken,
        matrixTokenAddress,
        MAX_UINT_256,
        wbtcRate,
        ZERO_ADDRESS,
      ]);

      expect(JSON.stringify(calldata)).eq(JSON.stringify([kyberNetworkProxy.address, ZERO, expectedCallData]));
    });
  });
});
