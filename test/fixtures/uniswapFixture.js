// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers, waffle } = require('hardhat');
const { provider } = waffle;
const { BigNumber } = ethers;

// ==================== Internal Imports ====================

const dependencies = require('./dependencies');
const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { ZERO_ADDRESS, ONE_DAY_IN_SECONDS } = require('../helpers/constants');

class UniswapFixture {
  constructor(owner) {
    this.owner = owner;

    this.uni = ZERO_ADDRESS;
    this.uniswapGovernorAlpha = ZERO_ADDRESS;
    this.uniswapTimelock = ZERO_ADDRESS;
    this.factory = ZERO_ADDRESS;
    this.router = ZERO_ADDRESS;

    this.uniWethPool = ZERO_ADDRESS;
    this.wethDaiPool = ZERO_ADDRESS;
    this.wethWbtcPool = ZERO_ADDRESS;

    this.wethDaiStakingRewards = ZERO_ADDRESS;
    this.wethWbtcStakingRewards = ZERO_ADDRESS;
  }

  async init(weth, wbtc, dai) {
    this.factory = await deployContract('UniswapV2Factory', [this.owner.address], this.owner);
    this.router = await deployContract('UniswapV2Router02', [this.factory.address, weth], this.owner);

    const lastBlock = await provider.getBlock('latest');
    this.uni = await deployContract('Uni', [this.owner.address, this.owner.address, BigNumber.from(lastBlock.timestamp).add(2)], this.owner);
    this.uniswapTimelock = await deployContract('UniswapTimelock', [this.owner.address, ONE_DAY_IN_SECONDS * 2], this.owner);
    this.uniswapGovernorAlpha = await deployContract('UniswapGovernorAlpha', [this.uniswapTimelock.address, this.uni.address], this.owner);

    [this.wethDaiPool, this.wethDaiStakingRewards] = await this.createNewStakingPair(weth, dai);
    [this.wethWbtcPool, this.wethWbtcStakingRewards] = await this.createNewStakingPair(weth, wbtc);
    this.uniWethPool = await this.createNewPair(weth, this.uni.address);
  }

  async createNewStakingPair(token1, token2) {
    const poolInstance = await this.createNewPair(token1, token2);
    const stakingInstance = await deployContract('StakingRewards', [this.owner.address, this.uni.address, poolInstance.address], this.owner);

    await this.uni.connect(this.owner).transfer(stakingInstance.address, ethToWei(5000000));
    await stakingInstance.connect(this.owner).notifyRewardAmount(ethToWei(5000000));
    return [poolInstance, stakingInstance];
  }

  async createNewPair(token1, token2) {
    await this.factory.createPair(token1, token2);
    const poolAddress = await this.factory.allPairs((await this.factory.allPairsLength()).sub(1));
    const UniswapV2Pair = await ethers.getContractFactory('UniswapV2Pair');
    return await UniswapV2Pair.attach(poolAddress);
  }

  getTokenOrder(token1, token2) {
    return token1.toLowerCase() < token2.toLowerCase() ? [token1, token2] : [token2, token1];
  }

  async getForkedUniswapRouter() {
    const UniswapV2Router02 = await ethers.getContractFactory('UniswapV2Router02');
    return await UniswapV2Router02.attach(dependencies.UNISWAP_ROUTER[1]).connect(this.owner);
  }

  async getForkedSushiswapRouter() {
    const UniswapV2Router02 = await ethers.getContractFactory('UniswapV2Router02');
    return await UniswapV2Router02.attach(dependencies.SUSHISWAP_ROUTER[1]).connect(this.owner);
  }
}

module.exports = {
  UniswapFixture,
};
