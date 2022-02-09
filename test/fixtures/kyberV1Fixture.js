// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { ZERO_ADDRESS } = require('../helpers/constants');

class KyberV1Fixture {
  constructor(owner) {
    this.owner = owner;

    this.factory = ZERO_ADDRESS;
    this.router = ZERO_ADDRESS;

    this.wethDaiPool = ZERO_ADDRESS;
    this.wethWbtcPool = ZERO_ADDRESS;
  }

  async init(weth, wbtc, dai) {
    this.factory = await deployContract('DMMFactory', [this.owner.address], this.owner);
    this.router = await deployContract('DMMRouter02', [this.factory.address, weth], this.owner);

    this.knc = await deployContract('Erc20Mock', ['Mock1', 'M1', 18], this.owner);
    await this.knc.mint(this.owner.address, ethToWei(100000));

    this.kncWethPool = await this.createNewPool(weth, this.knc.address, 19000);
    this.wethDaiPool = await this.createNewPool(weth, dai, 10000);
    this.wethWbtcPool = await this.createNewPool(weth, wbtc, 15000);
  }

  getTokenOrder(token1, token2) {
    return token1.toLowerCase() < token2.toLowerCase() ? [token1, token2] : [token2, token1];
  }

  async createNewPool(tokenA, tokenB, ampBps) {
    await this.factory.createPool(tokenA, tokenB, ampBps);
    const allPoolsLength = await this.factory.allPoolsLength();
    const index = allPoolsLength.sub(1);
    const poolAddress = await this.factory.allPools(index);
    const DMMPool = await ethers.getContractFactory('DMMPool');
    return await DMMPool.attach(poolAddress);
  }
}

module.exports = {
  KyberV1Fixture,
};
