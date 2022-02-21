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

describe('contract CurveStakingAdapter', async () => {
  const [owner, protocolFeeRecipient] = await getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);

  let curveStakingAdapter;
  let gaugeControllerMock;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    gaugeControllerMock = await deployContract('GaugeControllerMock', [], owner);
    curveStakingAdapter = await deployContract('CurveStakingAdapter', [gaugeControllerMock.address], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    it('set the correct variables', async () => {
      expect(await curveStakingAdapter.getGaugeController()).eq(gaugeControllerMock.address);
    });
  });

  describe('getSpenderAddress', async () => {
    it('should return the correct address', async () => {
      const stakingContract = await getRandomAddress();
      const spender = await curveStakingAdapter.getSpenderAddress(stakingContract);
      expect(spender).eq(stakingContract);
    });
  });

  describe('getStakeCallData', async () => {
    const amount = ethToWei(1);
    const stakeSignature = '0xb6b55f25'; // deposit(uint256)
    const generateCallData = (amount) => stakeSignature + bigNumberToData(amount);

    let stakingContract;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      stakingContract = await getRandomAddress();
      await gaugeControllerMock.addGaugeType(stakingContract, 0);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function getStakeCallData() {
      return curveStakingAdapter.getStakeCallData(stakingContract, amount);
    }

    it('should return the correct target, value and calldata', async () => {
      const [targetAddress, ethValue, callData] = await getStakeCallData();

      expect(targetAddress).eq(stakingContract);
      expect(ethValue).eq(ZERO);
      expect(callData).eq(generateCallData(amount));
    });

    it('should revert when an invalid staking contract is used', async () => {
      stakingContract = await getRandomAddress();
      await expect(getStakeCallData()).revertedWith('CSA0');
    });
  });

  describe('getUnstakeCallData', async () => {
    const amount = ethToWei(1);
    const unstakeSignature = '0x2e1a7d4d'; // withdraw(uint256)
    const generateCallData = (amount) => unstakeSignature + bigNumberToData(amount);

    let stakingContract;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      stakingContract = await getRandomAddress();
      await gaugeControllerMock.addGaugeType(stakingContract, 0);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function getUnstakeCallData() {
      return curveStakingAdapter.getUnstakeCallData(stakingContract, amount);
    }

    it('should return the correct target, value and calldata', async () => {
      const [targetAddress, ethValue, callData] = await getUnstakeCallData();

      expect(targetAddress).eq(stakingContract);
      expect(ethValue).eq(ZERO);
      expect(callData).eq(generateCallData(amount));
    });

    it('should revert when an invalid staking contract is used', async () => {
      stakingContract = await getRandomAddress();
      await expect(getUnstakeCallData()).revertedWith('CSA1');
    });
  });
});
