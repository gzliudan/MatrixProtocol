// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ZERO_ADDRESS } = require('../helpers/constants');
const { getSigners } = require('../helpers/accountUtil');
const { ethToWei, usdToWei } = require('../helpers/unitUtil');
const { preciseMul, preciseDiv } = require('../helpers/mathUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');
const { ETH_USD_PRICE, USD_USD_PRICE, SystemFixture } = require('../fixtures/systemFixture');

describe('contract MatrixValuer', () => {
  const [owner, feeRecipient, moduleOne] = getSigners();
  const units = [usdToWei(100), ethToWei(1)]; // 100 USDC at $1 and 1 WETH at $230
  const baseUnits = [usdToWei(1), ethToWei(1)]; // Base units of USDC and WETH
  const systemFixture = new SystemFixture(owner, feeRecipient);

  let matrixToken;
  let components;
  let modules;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();
    components = [systemFixture.usdc.address, systemFixture.weth.address];
    modules = [moduleOne.address];
    await systemFixture.controller.connect(owner).addModule(moduleOne.address);
    matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
    matrixToken.connect(moduleOne).initializeModule();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    it('should have the correct controller address', async () => {
      const result = await systemFixture.matrixValuer.getController();
      expect(result).eq(systemFixture.controller.address);
    });
  });

  describe('calculateMatrixTokenValuation', () => {
    let quoteAsset;

    beforeEach(async () => {
      quoteAsset = systemFixture.usdc.address;
    });

    async function calculateMatrixTokenValuation() {
      return await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixToken.address, quoteAsset);
    }

    it('should calculate correct MatrixToken valuation', async () => {
      const result = await calculateMatrixTokenValuation();
      const usdcNormalizedUnit = preciseDiv(units[0], baseUnits[0]);
      const wethNormalizedUnit = preciseDiv(units[1], baseUnits[1]);
      const expected = preciseMul(usdcNormalizedUnit, USD_USD_PRICE).add(preciseMul(wethNormalizedUnit, ETH_USD_PRICE));
      expect(result).eq(expected);
    });

    it('should calculate correct MatrixToken valuation when the quote asset is not the master quote asset', async () => {
      quoteAsset = systemFixture.weth.address;
      const result = await calculateMatrixTokenValuation();
      const usdcNormalizedUnit = preciseDiv(units[0], baseUnits[0]);
      const wethNormalizedUnit = preciseDiv(units[1], baseUnits[1]);
      const quoteToMasterQuote = await systemFixture.ethUsdOracle.read();
      const masterQuoteValuation = preciseMul(usdcNormalizedUnit, USD_USD_PRICE).add(preciseMul(wethNormalizedUnit, ETH_USD_PRICE));
      const expected = preciseDiv(masterQuoteValuation, quoteToMasterQuote);
      expect(result).eq(expected);
    });

    it('should calculate correct MatrixToken valuation when a Set token has an external position', async () => {
      const externalUnits = ethToWei(100);
      await matrixToken.connect(moduleOne).addExternalPositionModule(systemFixture.usdc.address, ZERO_ADDRESS);
      await matrixToken.connect(moduleOne).editExternalPositionUnit(systemFixture.usdc.address, ZERO_ADDRESS, externalUnits);
      const result = await calculateMatrixTokenValuation();
      const expected = preciseMul(preciseDiv(units[0].add(externalUnits), baseUnits[0]), USD_USD_PRICE).add(
        preciseMul(preciseDiv(units[1], baseUnits[1]), ETH_USD_PRICE)
      );
      expect(result).eq(expected);
    });

    it('should calculate correct MatrixToken valuation when has a negative external position', async () => {
      const externalUnits = usdToWei(-10);
      await matrixToken.connect(moduleOne).editExternalPositionUnit(systemFixture.usdc.address, ZERO_ADDRESS, externalUnits);
      const result = await calculateMatrixTokenValuation();
      const expected = preciseMul(preciseDiv(units[0].add(externalUnits), baseUnits[0]), USD_USD_PRICE).add(
        preciseMul(preciseDiv(units[1], baseUnits[1]), ETH_USD_PRICE)
      );
      expect(result).eq(expected);
    });

    it('should revert when valuation is negative', async () => {
      const externalUnits = ethToWei(-500);
      await matrixToken.connect(moduleOne).editExternalPositionUnit(systemFixture.usdc.address, ZERO_ADDRESS, externalUnits);
      await expect(calculateMatrixTokenValuation()).revertedWith('SafeCast: value must be positive');
    });
  });
});
