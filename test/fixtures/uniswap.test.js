// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { SystemFixture } = require('./systemFixture');
const { UniswapFixture } = require('./uniswapFixture');
const { getSigners } = require('../helpers/accountUtil');
const { ZERO, MAX_UINT_256 } = require('../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('class UniswapFixture', () => {
  const [owner, protocolFeeRecipient] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const uniswapFixture = new UniswapFixture(owner);

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('init', () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function init() {
      await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
    }

    it('should deploy a WETH/DAI pool and staking rewards', async () => {
      await init();

      const pairTokenOne = await uniswapFixture.wethDaiPool.token0();
      const pairTokenTwo = await uniswapFixture.wethDaiPool.token1();
      const rewardToken = await uniswapFixture.wethDaiStakingRewards.rewardsToken();
      const stakingToken = await uniswapFixture.wethDaiStakingRewards.stakingToken();

      const [expectedTokenOne, expectedTokenTwo] = uniswapFixture.getTokenOrder(systemFixture.weth.address, systemFixture.dai.address);

      expect(pairTokenOne).eq(expectedTokenOne);
      expect(pairTokenTwo).eq(expectedTokenTwo);
      expect(rewardToken).eq(uniswapFixture.uni.address);
      expect(stakingToken).eq(uniswapFixture.wethDaiPool.address);
    });

    it('should deploy a WETH/WBTC pool and staking rewards', async () => {
      await init();

      const pairTokenOne = await uniswapFixture.wethWbtcPool.token0();
      const pairTokenTwo = await uniswapFixture.wethWbtcPool.token1();
      const rewardToken = await uniswapFixture.wethWbtcStakingRewards.rewardsToken();
      const stakingToken = await uniswapFixture.wethWbtcStakingRewards.stakingToken();

      const [expectedTokenOne, expectedTokenTwo] = uniswapFixture.getTokenOrder(systemFixture.weth.address, systemFixture.wbtc.address);

      expect(pairTokenOne).eq(expectedTokenOne);
      expect(pairTokenTwo).eq(expectedTokenTwo);
      expect(rewardToken).eq(uniswapFixture.uni.address);
      expect(stakingToken).eq(uniswapFixture.wethWbtcPool.address);
    });
  });

  describe('addLiquidity', () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
      await systemFixture.weth.approve(uniswapFixture.router.address, ethToWei(1));
      await systemFixture.dai.approve(uniswapFixture.router.address, ethToWei(350));
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function addLiquidity() {
      await uniswapFixture.router.addLiquidity(
        systemFixture.weth.address,
        systemFixture.dai.address,
        ethToWei(1),
        ethToWei(350),
        ethToWei(0.99),
        ethToWei(353.5),
        owner.address,
        MAX_UINT_256
      );
    }

    it('should return lp token to owner and decrement amounts', async () => {
      const oldDaiBalance = await systemFixture.dai.balanceOf(owner.address);
      const oldWethBalance = await systemFixture.weth.balanceOf(owner.address);
      await addLiquidity();
      const newDaiBalance = await systemFixture.dai.balanceOf(owner.address);
      const newWethBalance = await systemFixture.weth.balanceOf(owner.address);

      const lpTokenBalance = await uniswapFixture.wethDaiPool.balanceOf(owner.address);

      expect(oldDaiBalance.sub(ethToWei(350))).eq(newDaiBalance);
      expect(oldWethBalance.sub(ethToWei(1))).eq(newWethBalance);
      expect(lpTokenBalance).gt(ZERO);
    });
  });

  describe('stake', () => {
    let stakeAmount;

    beforeEach(async () => {
      await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);

      await systemFixture.weth.approve(uniswapFixture.router.address, ethToWei(1));
      await systemFixture.dai.approve(uniswapFixture.router.address, ethToWei(350));

      await uniswapFixture.router.addLiquidity(
        systemFixture.weth.address,
        systemFixture.dai.address,
        ethToWei(1),
        ethToWei(350),
        ethToWei(0.99),
        ethToWei(353.5),
        owner.address,
        MAX_UINT_256
      );

      stakeAmount = await uniswapFixture.wethDaiPool.balanceOf(owner.address);

      await uniswapFixture.wethDaiPool.approve(uniswapFixture.wethDaiStakingRewards.address, stakeAmount);
    });

    async function stake() {
      await uniswapFixture.wethDaiStakingRewards.stake(stakeAmount);
    }

    it('should stake lp tokens', async () => {
      const oldRewards = await uniswapFixture.wethDaiStakingRewards.balanceOf(owner.address);
      await stake();
      const newRewards = await uniswapFixture.wethDaiStakingRewards.balanceOf(owner.address);
      expect(newRewards.sub(oldRewards)).eq(stakeAmount);
    });
  });
});
