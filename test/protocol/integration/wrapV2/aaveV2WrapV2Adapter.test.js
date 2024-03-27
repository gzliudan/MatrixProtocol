// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ZERO, ZERO_BYTES } = require('../../../helpers/constants');
const { ethToWei } = require('../../../helpers/unitUtil');
const { deployContract } = require('../../../helpers/deploy');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { AaveV2Fixture } = require('../../../fixtures/aaveV2Fixture');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract AaveV2WrapV2Adapter', () => {
  const [owner, protocolFeeRecipient, INVALID_TOKEN] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const aaveV2Fixture = new AaveV2Fixture(owner);

  let wrappedToken; // Aave V2 AToken
  let underlyingToken;
  let aaveV2WrapV2Adapter;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
    await aaveV2Fixture.init(systemFixture.weth.address, systemFixture.dai.address);

    underlyingToken = systemFixture.dai;
    wrappedToken = aaveV2Fixture.daiReserveTokens.aToken;

    aaveV2WrapV2Adapter = await deployContract('AaveV2WrapV2Adapter', [aaveV2Fixture.lendingPoolAddressesProvider.address], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    it('should have the correct lending pool addresses provider', async () => {
      expect(await aaveV2WrapV2Adapter.ADDRESSES_PROVIDER()).eq(aaveV2Fixture.lendingPoolAddressesProvider.address);
    });
  });

  describe('getSpenderAddress', () => {
    it('should return the correct spender address', async () => {
      expect(await aaveV2WrapV2Adapter.getSpenderAddress(underlyingToken.address, wrappedToken.address)).eq(aaveV2Fixture.lendingPool.address);
    });
  });

  describe('getWrapCallData', () => {
    const subjectUnderlyingUnits = ethToWei(2);
    const subjectWrapData = ZERO_BYTES;

    let to;
    let wrappedTokenAddress;
    let underlyingTokenAddress;

    beforeEach(async () => {
      to = await getRandomAddress();
      wrappedTokenAddress = wrappedToken.address;
      underlyingTokenAddress = underlyingToken.address;
    });

    async function getWrapCallData() {
      return aaveV2WrapV2Adapter.getWrapCallData(underlyingTokenAddress, wrappedTokenAddress, subjectUnderlyingUnits, to, subjectWrapData);
    }

    it('should return correct data for valid pair', async () => {
      const { target, value, callData } = await getWrapCallData();
      const expectedCallData = aaveV2Fixture.lendingPool.interface.encodeFunctionData('deposit', [underlyingTokenAddress, subjectUnderlyingUnits, to, 0]);

      expect(target).eq(aaveV2Fixture.lendingPool.address);
      expect(value).eq(ZERO);
      expect(callData).eq(expectedCallData);
    });

    it('should revert when wrapped underlying token is invalid', async () => {
      underlyingTokenAddress = INVALID_TOKEN.address;
      await expect(getWrapCallData()).revertedWith('A2Wb0');
    });

    it('should revert when wrapped wrapped token is invalid', async () => {
      wrappedTokenAddress = aaveV2Fixture.wethReserveTokens.aToken.address;
      await expect(getWrapCallData()).revertedWith('A2Wb0');
    });
  });

  describe('getUnwrapCallData', () => {
    let unwrapData = ZERO_BYTES;
    let wrappedTokenUnits = ethToWei(2);

    let to;
    let wrappedTokenAddress;
    let underlyingTokenAddress;

    beforeEach(async () => {
      to = await getRandomAddress();
      wrappedTokenAddress = wrappedToken.address;
      underlyingTokenAddress = underlyingToken.address;
    });

    async function getUnwrapCallData() {
      return aaveV2WrapV2Adapter.getUnwrapCallData(underlyingTokenAddress, wrappedTokenAddress, wrappedTokenUnits, to, unwrapData);
    }

    it('should return correct data for valid pair', async () => {
      const { target, value, callData } = await getUnwrapCallData();
      const expectedCallData = aaveV2Fixture.lendingPool.interface.encodeFunctionData('withdraw', [underlyingTokenAddress, wrappedTokenUnits, to]);

      expect(target).eq(aaveV2Fixture.lendingPool.address);
      expect(value).eq(ZERO);
      expect(callData).eq(expectedCallData);
    });

    it('should revert when underlying token is invalid', async () => {
      underlyingTokenAddress = INVALID_TOKEN.address;
      await expect(getUnwrapCallData()).revertedWith('A2Wb0');
    });

    it('should revert when wrapped token is invalid', async () => {
      wrappedTokenAddress = aaveV2Fixture.wethReserveTokens.aToken.address;
      await expect(getUnwrapCallData()).revertedWith('A2Wb0');
    });
  });
});
