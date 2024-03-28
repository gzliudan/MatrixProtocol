// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ZERO } = require('../../../helpers/constants');
const { ethToWei } = require('../../../helpers/unitUtil');
const { deployContract } = require('../../../helpers/deploy');
const { bigNumberToData } = require('../../../helpers/adapterUtil');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { getSigners, getRandomAddress } = require('../../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');

describe('contract CurveStakingAdapter', function () {
  const [owner, protocolFeeRecipient] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);

  let curveStakingAdapter;
  let gaugeControllerMock;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    gaugeControllerMock = await deployContract('GaugeControllerMock', [], owner);
    curveStakingAdapter = await deployContract('CurveStakingAdapter', [gaugeControllerMock.address], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', function () {
    it('set the correct variables', async function () {
      expect(await curveStakingAdapter.getGaugeController()).eq(gaugeControllerMock.address);
    });
  });

  describe('getSpenderAddress', function () {
    it('should return the correct address', async function () {
      const stakingContract = await getRandomAddress();
      const spender = await curveStakingAdapter.getSpenderAddress(stakingContract);
      expect(spender).eq(stakingContract);
    });
  });

  describe('getStakeCallData', function () {
    const amount = ethToWei(1);
    const stakeSignature = '0xb6b55f25'; // deposit(uint256)

    function generateCallData(amount) {
      return stakeSignature + bigNumberToData(amount);
    }

    let stakingContract;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      stakingContract = await getRandomAddress();
      await gaugeControllerMock.addGaugeType(stakingContract, 0);
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getStakeCallData() {
      return curveStakingAdapter.getStakeCallData(stakingContract, amount);
    }

    it('should return the correct target, value and calldata', async function () {
      const [targetAddress, ethValue, callData] = await getStakeCallData();

      expect(targetAddress).eq(stakingContract);
      expect(ethValue).eq(ZERO);
      expect(callData).eq(generateCallData(amount));
    });

    it('should revert when an invalid staking contract is used', async function () {
      stakingContract = await getRandomAddress();
      await expect(getStakeCallData()).revertedWith('CSA0');
    });
  });

  describe('getUnstakeCallData', function () {
    const amount = ethToWei(1);
    const unstakeSignature = '0x2e1a7d4d'; // withdraw(uint256)

    function generateCallData(amount) {
      return unstakeSignature + bigNumberToData(amount);
    }

    let stakingContract;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      stakingContract = await getRandomAddress();
      await gaugeControllerMock.addGaugeType(stakingContract, 0);
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getUnstakeCallData() {
      return curveStakingAdapter.getUnstakeCallData(stakingContract, amount);
    }

    it('should return the correct target, value and calldata', async function () {
      const [targetAddress, ethValue, callData] = await getUnstakeCallData();

      expect(targetAddress).eq(stakingContract);
      expect(ethValue).eq(ZERO);
      expect(callData).eq(generateCallData(amount));
    });

    it('should revert when an invalid staking contract is used', async function () {
      stakingContract = await getRandomAddress();
      await expect(getUnstakeCallData()).revertedWith('CSA1');
    });
  });
});
