// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { ethers } = require('hardhat');

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { MAX_UINT_256, ZERO_ADDRESS } = require('../helpers/constants');
const { getCreatedMatrixTokenAddress } = require('../helpers/protocolUtil');

const ETH_USD_PRICE = ethToWei(230);
const USD_USD_PRICE = ethToWei(1);
const BTC_USD_PRICE = ethToWei(9000);
const DAI_USD_PRICE = ethToWei(1);

class SystemFixture {
  constructor(owner, feeRecipient) {
    this.owner = owner;
    this.feeRecipient = feeRecipient;

    this.weth = ZERO_ADDRESS;
    this.usdc = ZERO_ADDRESS;
    this.wbtc = ZERO_ADDRESS;
    this.dai = ZERO_ADDRESS;
    this.ethUsdOracle = ZERO_ADDRESS;
    this.usdUsdOracle = ZERO_ADDRESS;
    this.btcUsdOracle = ZERO_ADDRESS;
    this.daiUsdOracle = ZERO_ADDRESS;
    this.controller = ZERO_ADDRESS;
    this.factory = ZERO_ADDRESS;
    this.integrationRegistry = ZERO_ADDRESS;
    this.priceOracle = ZERO_ADDRESS;
    this.matrixValuer = ZERO_ADDRESS;
    this.basicIssuanceModule = ZERO_ADDRESS;
    this.streamingFeeModule = ZERO_ADDRESS;
    this.navIssuanceModule = ZERO_ADDRESS;
  }

  async initComponents() {
    this.weth = await deployContract('WETH9', [], this.owner);
    this.usdc = await deployContract('Erc20Mock', ['USDC', 'USDC', 6], this.owner);
    this.wbtc = await deployContract('Erc20Mock', ['WBTC', 'WBTC', 8], this.owner);
    this.dai = await deployContract('Erc20Mock', ['DAI', 'DAI', 18], this.owner);

    this.ethUsdOracle = await deployContract('OracleMock', [ETH_USD_PRICE], this.owner);
    this.usdUsdOracle = await deployContract('OracleMock', [USD_USD_PRICE], this.owner);
    this.btcUsdOracle = await deployContract('OracleMock', [BTC_USD_PRICE], this.owner);
    this.daiUsdOracle = await deployContract('OracleMock', [DAI_USD_PRICE], this.owner);

    await this.weth.connect(this.owner).deposit({ value: ethToWei(5000) });
    await this.usdc.connect(this.owner).mint(this.owner.address, ethToWei(10000));
    await this.wbtc.connect(this.owner).mint(this.owner.address, ethToWei(10000));
    await this.dai.connect(this.owner).mint(this.owner.address, ethToWei(1000000));

    await this.weth.connect(this.owner).approve(this.basicIssuanceModule.address, ethToWei(10000));
    await this.usdc.connect(this.owner).approve(this.basicIssuanceModule.address, ethToWei(10000));
    await this.wbtc.connect(this.owner).approve(this.basicIssuanceModule.address, ethToWei(10000));
    await this.dai.connect(this.owner).approve(this.basicIssuanceModule.address, ethToWei(10000));
  }

  async initAll() {
    this.controller = await deployContract('Controller', [this.feeRecipient.address], this.owner);
    this.matrixValuer = await deployContract('MatrixValuer', [this.controller.address], this.owner);
    this.factory = await deployContract('MatrixTokenFactory', [this.controller.address], this.owner);
    this.streamingFeeModule = await deployContract('StreamingFeeModule', [this.controller.address, 'StreamingFeeModule'], this.owner);
    this.basicIssuanceModule = await deployContract('BasicIssuanceModule', [this.controller.address, 'BasicIssuanceModule'], this.owner);
    this.integrationRegistry = await deployContract('IntegrationRegistry', [this.controller.address], this.owner);

    await this.initComponents();

    this.navIssuanceModule = await deployContract('NavIssuanceModule', [this.controller.address, this.weth.address, 'NavIssuanceModule'], this.owner);

    this.priceOracle = await deployContract(
      'PriceOracle',
      [
        this.controller.address,
        this.usdc.address, // masterQuoteAsset
        [], // oracleAdapters
        [this.weth.address, this.usdc.address, this.wbtc.address, this.dai.address], // assetOnes
        [this.usdc.address, this.usdc.address, this.usdc.address, this.usdc.address], // assetTwos
        [this.ethUsdOracle.address, this.usdUsdOracle.address, this.btcUsdOracle.address, this.daiUsdOracle.address], // oracles
      ],
      this.owner
    );

    await this.controller.connect(this.owner).initialize(
      [this.factory.address], // factories
      [this.basicIssuanceModule.address, this.streamingFeeModule.address, this.navIssuanceModule.address], // modules
      [this.integrationRegistry.address, this.priceOracle.address, this.matrixValuer.address], // resources
      [0, 1, 2] // resource IDs: IntegrationRegistry=0; PriceOracle=1; MatrixValuer=2
    );
  }

  async createMatrixToken(components, units, modules, manager, name = 'MatrixToken', symbol = 'MAT') {
    const managerAddress = manager?.address ? manager.address : manager;
    const receipt = await this.factory.create(components, units, modules, managerAddress, name, symbol);
    const matrixTokenAddress = await getCreatedMatrixTokenAddress(receipt.hash);
    const MatrixToken = await ethers.getContractFactory('MatrixToken');
    return await MatrixToken.attach(matrixTokenAddress);
  }

  async createRawMatrixToken(components, units, modules, manager, name = 'MatrixToken', symbol = 'MAT') {
    const managerAddress = manager?.address ? manager.address : manager;
    return await deployContract('MatrixToken', [components, units, modules, this.controller.address, managerAddress, name, symbol]);
  }

  async approveAndIssueMatrixToken(matrixToken, quantity, to) {
    const positions = await matrixToken.getPositions();

    for (let i = 0; i < positions.length; i++) {
      const { component } = positions[i];

      const Erc20Mock = await ethers.getContractFactory('Erc20Mock');
      const componentInstance = await Erc20Mock.attach(component);
      await componentInstance.approve(this.basicIssuanceModule.address, MAX_UINT_256);
    }

    await this.basicIssuanceModule.issue(matrixToken.address, quantity, to);
  }
}

module.exports = {
  ETH_USD_PRICE,
  USD_USD_PRICE,
  BTC_USD_PRICE,
  DAI_USD_PRICE,
  SystemFixture,
};
