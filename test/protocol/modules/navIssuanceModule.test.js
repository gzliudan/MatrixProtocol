// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { ethers } = require('hardhat');

// ==================== Internal Imports ====================

const { preciseMul } = require('../../helpers/mathUtil');
const { deployContract } = require('../../helpers/deploy');
const { compareArray } = require('../../helpers/arrayUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ethToWei, btcToWei, usdToWei } = require('../../helpers/unitUtil');
const { ZERO_ADDRESS, ZERO, ONE, TWO, THREE } = require('../../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');
const { getSigners, getEthBalance, getRandomAddress } = require('../../helpers/accountUtil');

const {
  getExpectedIssuePositionMultiplier,
  getExpectedIssuePositionUnit,
  getExpectedPostFeeQuantity,
  getExpectedMatrixTokenIssueQuantity,
  getExpectedReserveRedeemQuantity,
  getExpectedRedeemPositionMultiplier,
  getExpectedRedeemPositionUnit,
} = require('../../helpers/navIssuanceModuleUtils.js');

async function reconcileBalances(matrixToken, testFun, signer) {
  await testFun();

  const newTotalSupply = await matrixToken.totalSupply();
  const components = await matrixToken.getComponents();

  for (let i = 0; i < components.length; i++) {
    const ERC20 = await ethers.getContractFactory('ERC20', signer);
    const component = await ERC20.attach(components[i]);
    const result = await component.balanceOf(matrixToken.address);

    const positionUnit = await matrixToken.getDefaultPositionRealUnit(component.address);
    const expected = preciseMul(positionUnit, newTotalSupply);
    expect(result).gte(expected);
  }
}

describe('contract NavIssuanceModule', () => {
  const [owner, protocolFeeRecipient, feeRecipient, recipient, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let matrixToken;
  let matrixTokenAddress;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    it('should set the correct controller', async () => {
      const controller = await systemFixture.navIssuanceModule.getController();
      expect(controller).eq(systemFixture.controller.address);
    });

    it('should set the correct weth contract', async () => {
      const weth = await systemFixture.navIssuanceModule.getWeth();
      expect(weth).eq(systemFixture.weth.address);
    });
  });

  describe('initialize', () => {
    const managerFees = [ethToWei(0.001), ethToWei(0.002)]; // Set manager issue fee to 0.1% and redeem to 0.2%
    const maxManagerFee = ethToWei(0.02); // Set max managerFee to 2%
    const premiumPercentage = ethToWei(0.01); // Set premium to 1%
    const maxPremiumPercentage = ethToWei(0.1); // Set max premium to 10%
    const minMatrixTokenSupply = ethToWei(100); // Set min MatrixToken supply to 100 units
    const units = [ethToWei(1)];

    let managerIssuanceHook;
    let managerRedemptionHook;
    let reserveAssets;
    let managerFeeRecipient;
    let navIssuanceSetting;
    let components;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
      managerIssuanceHook = await getRandomAddress();
      managerRedemptionHook = await getRandomAddress();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      caller = owner;
      components = [systemFixture.weth.address];
      const modules = [systemFixture.navIssuanceModule.address];
      matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      reserveAssets = [systemFixture.usdc.address, systemFixture.weth.address];
      managerFeeRecipient = feeRecipient.address;

      navIssuanceSetting = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minMatrixTokenSupply,
      };
    });

    async function initialize() {
      return systemFixture.navIssuanceModule.connect(caller).initialize(matrixTokenAddress, navIssuanceSetting);
    }

    it('should set the correct reserve assets', async () => {
      await initialize();
      const result = await systemFixture.navIssuanceModule.getReserveAssets(matrixTokenAddress);
      expect(compareArray(result, reserveAssets)).is.true;
    });

    it('should set the correct manager fees', async () => {
      await initialize();
      const managerIssueFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, ZERO);
      expect(managerIssueFee).eq(managerFees[0]);
      const managerRedeemFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, ONE);
      expect(managerRedeemFee).eq(managerFees[1]);
    });

    it('should set the correct NAV issuance settings', async () => {
      await initialize();
      const result = await systemFixture.navIssuanceModule.getIssuanceSetting(matrixTokenAddress);
      expect(result.managerIssuanceHook).eq(managerIssuanceHook);
      expect(result.managerRedemptionHook).eq(managerRedemptionHook);
      expect(result.feeRecipient).eq(managerFeeRecipient);
      expect(result.maxManagerFee).eq(maxManagerFee);
      expect(result.premiumPercentage).eq(premiumPercentage);
      expect(result.maxPremiumPercentage).eq(maxPremiumPercentage);
      expect(result.minMatrixTokenSupply).eq(minMatrixTokenSupply);
    });

    it('should enable the Module on the MatrixToken', async () => {
      await initialize();
      const result = await matrixToken.isInitializedModule(systemFixture.navIssuanceModule.address);
      expect(result).is.true;
    });

    it('should properly set reserve assets mapping', async () => {
      await initialize();
      const usdcIsReserveAsset = await systemFixture.navIssuanceModule.isReserveAsset(matrixTokenAddress, systemFixture.usdc.address);
      expect(usdcIsReserveAsset).is.true;
      const wethIsReserveAsset = await systemFixture.navIssuanceModule.isReserveAsset(matrixTokenAddress, systemFixture.weth.address);
      expect(wethIsReserveAsset).is.true;
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = await randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when MatrixToken is not in pending state', async () => {
      const newModule = await getRandomAddress();
      await systemFixture.controller.addModule(newModule);
      const newToken = await systemFixture.createMatrixToken(components, units, [newModule], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const newToken = await systemFixture.createRawMatrixToken(components, units, [systemFixture.navIssuanceModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });

    it('should revert when no reserve assets are specified', async () => {
      navIssuanceSetting.reserveAssets = [];
      await expect(initialize()).revertedWith('N0a');
    });

    it('should revert when reserve asset is duplicated', async () => {
      navIssuanceSetting.reserveAssets = [systemFixture.weth.address, systemFixture.weth.address];
      await expect(initialize()).revertedWith('N0i');
    });

    it('should revert when manager issue fee is greater than max', async () => {
      navIssuanceSetting.managerFees = [ethToWei(1), ethToWei(0.002)]; // Set to 100%
      await expect(initialize()).revertedWith('N0d');
    });

    it('should revert when manager redeem fee is greater than max', async () => {
      navIssuanceSetting.managerFees = [ethToWei(0.001), ethToWei(1)]; // Set to 100%
      await expect(initialize()).revertedWith('N0e');
    });

    it('should revert when max manager fee is greater than 100%', async () => {
      navIssuanceSetting.maxManagerFee = ethToWei(2); // Set to 200%
      await expect(initialize()).revertedWith('N0b');
    });

    it('should revert when premium is greater than max', async () => {
      navIssuanceSetting.premiumPercentage = ethToWei(1); // Set to 100%
      await expect(initialize()).revertedWith('N0f');
    });

    it('should revert when premium is greater than 100%', async () => {
      navIssuanceSetting.maxPremiumPercentage = ethToWei(2); // Set to 100%
      await expect(initialize()).revertedWith('N0c');
    });

    it('should revert when feeRecipient is zero address', async () => {
      navIssuanceSetting.feeRecipient = ZERO_ADDRESS;
      await expect(initialize()).revertedWith('N0g');
    });

    it('should revert when min MatrixToken supply is 0', async () => {
      navIssuanceSetting.minMatrixTokenSupply = ZERO;
      await expect(initialize()).revertedWith('N0h');
    });
  });

  describe('removeModule', () => {
    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply required
      };

      await systemFixture.navIssuanceModule.connect(owner).initialize(matrixTokenAddress, navIssuanceSetting);
    });

    async function removeModule() {
      return matrixToken.removeModule(systemFixture.navIssuanceModule.address);
    }

    it('should delete reserve assets state', async () => {
      await removeModule();
      const isUsdcReserveAsset = await systemFixture.navIssuanceModule.isReserveAsset(matrixToken.address, systemFixture.usdc.address);
      expect(isUsdcReserveAsset).is.false;
      const isWethReserveAsset = await systemFixture.navIssuanceModule.isReserveAsset(matrixToken.address, systemFixture.weth.address);
      expect(isWethReserveAsset).is.false;
    });

    it('should delete the reserve assets', async () => {
      await removeModule();
      const retrievedReserveAssets = await systemFixture.navIssuanceModule.getReserveAssets(matrixTokenAddress);
      expect(retrievedReserveAssets).is.empty;
    });

    it('should delete the manager fees', async () => {
      await removeModule();
      const managerIssueFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, ZERO);
      expect(managerIssueFee).eq(ZERO);
      const managerRedeemFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, ONE);
      expect(managerRedeemFee).eq(ZERO);
    });

    it('should delete the NAV issuance settings', async () => {
      await removeModule();
      const result = await systemFixture.navIssuanceModule.getIssuanceSetting(matrixTokenAddress);
      expect(result.managerIssuanceHook).eq(ZERO_ADDRESS);
      expect(result.managerRedemptionHook).eq(ZERO_ADDRESS);
      expect(result.feeRecipient).eq(ZERO_ADDRESS);
      expect(result.maxManagerFee).eq(ZERO);
      expect(result.premiumPercentage).eq(ZERO);
      expect(result.maxPremiumPercentage).eq(ZERO);
      expect(result.minMatrixTokenSupply).eq(ZERO);
    });
  });

  describe('getReserveAssets', () => {
    let reserveAssets;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;

      reserveAssets = [systemFixture.usdc.address, systemFixture.weth.address];

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets,
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);
    });

    it('should return the valid reserve assets', async () => {
      const result = await systemFixture.navIssuanceModule.getReserveAssets(matrixTokenAddress);
      expect(compareArray(result, reserveAssets)).is.true;
    });
  });

  describe('getIssuePremium', () => {
    let premiumPercentage;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      premiumPercentage = ethToWei(0.01); // Set premium to 1%

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage,
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);
    });

    it('should return the correct premium', async () => {
      const reserveAsset = await getRandomAddress(); // Unused in NavIssuanceModule V1
      const reserveQuantity = ethToWei(1); // Unused in NAVIssuanceModule V1
      const result = await systemFixture.navIssuanceModule.getIssuePremium(matrixTokenAddress, reserveAsset, reserveQuantity);
      expect(result).eq(premiumPercentage);
    });
  });

  describe('getRedeemPremium', () => {
    let premiumPercentage;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      premiumPercentage = ethToWei(0.01); // Set premium to 1%

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage,
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);
    });

    it('should return the correct premium', async () => {
      const reserveAsset = await getRandomAddress(); // Unused in NavIssuanceModule V1
      const matrixTokenQuantity = ethToWei(1); // Unused in NAVIssuanceModule V1
      const result = await systemFixture.navIssuanceModule.getRedeemPremium(matrixTokenAddress, reserveAsset, matrixTokenQuantity);
      expect(result).eq(premiumPercentage);
    });
  });

  describe('getManagerFee', () => {
    let managerFees;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      managerFees = [ethToWei(0.001), ethToWei(0.002)]; // Set manager issue fee to 0.1% and redeem to 0.2%

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees,
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);
    });

    it('should return the manager fee', async () => {
      const result = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, ZERO);
      expect(result).eq(managerFees[0]);
    });
  });

  describe('getExpectedMatrixTokenIssueQuantity', () => {
    let managerFees;
    let protocolDirectFee;
    let premiumPercentage;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      managerFees = [ethToWei(0.001), ethToWei(0.002)]; // Set manager issue fee to 0.1% and redeem to 0.2%
      premiumPercentage = ethToWei(0.01); // Set premium to 1%

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees,
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage,
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

      protocolDirectFee = ethToWei(0.02);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ethToWei(0.3);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ZERO, protocolManagerFee);
    });

    it('should return the correct expected MatrixToken issue quantity', async () => {
      const reserveAsset = systemFixture.usdc.address;
      const reserveQuantity = ethToWei(1);
      const result = await systemFixture.navIssuanceModule.getExpectedMatrixTokenIssueQuantity(matrixTokenAddress, reserveAsset, reserveQuantity);
      const expected = await getExpectedMatrixTokenIssueQuantity(
        matrixToken,
        systemFixture.matrixValuer,
        reserveAsset,
        usdToWei(1),
        reserveQuantity,
        managerFees[0],
        protocolDirectFee,
        premiumPercentage
      );

      expect(result).eq(expected);
    });
  });

  describe('getExpectedReserveRedeemQuantity', () => {
    let managerFees;
    let protocolDirectFee;
    let premiumPercentage;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
      const units = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)];
      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
      matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
      matrixTokenAddress = matrixToken.address;
      managerFees = [ethToWei(0.001), ethToWei(0.002)]; // Set manager issue fee to 0.1% and redeem to 0.2%
      premiumPercentage = ethToWei(0.01); // Set premium to 1%

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees,
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage,
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply to 1 unit
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

      // Approve tokens to the controller
      await systemFixture.weth.approve(systemFixture.controller.address, ethToWei(100));
      await systemFixture.usdc.approve(systemFixture.controller.address, usdToWei(1000000));
      await systemFixture.wbtc.approve(systemFixture.controller.address, btcToWei(1000000));
      await systemFixture.dai.approve(systemFixture.controller.address, ethToWei(1000000));

      // Seed with 10 supply
      await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
      await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(10), owner.address);

      protocolDirectFee = ethToWei(0.02);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, THREE, protocolDirectFee);

      const protocolManagerFee = ethToWei(0.3);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ONE, protocolManagerFee);
    });

    it('should return the correct expected reserve asset redeem quantity', async () => {
      const reserveAsset = systemFixture.usdc.address;
      const matrixTokenQuantity = ethToWei(1);

      const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
      const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
        matrixTokenQuantity,
        matrixTokenValuation,
        usdToWei(1), // USDC base units
        managerFees[1],
        protocolDirectFee, // Protocol fee percentage
        premiumPercentage
      );

      const result = await systemFixture.navIssuanceModule.getExpectedReserveRedeemQuantity(matrixTokenAddress, reserveAsset, matrixTokenQuantity);
      expect(result).eq(expectedRedeemQuantity);
    });
  });

  describe('isIssueValid', () => {
    let reserveAsset;
    let reserveQuantity;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();

      const protocolDirectFee = ethToWei(0.02);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ethToWei(0.3);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ZERO, protocolManagerFee);
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
      const uints = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)];
      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
      matrixToken = await systemFixture.createMatrixToken(components, uints, modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply to 1 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
      await systemFixture.usdc.approve(systemFixture.basicIssuanceModule.address, usdToWei(1000000));
      await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(1000000));
      await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000000));

      // Seed with 10 supply
      await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
      await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(10), owner.address);

      reserveAsset = systemFixture.usdc.address;
      reserveQuantity = usdToWei(100);
    });

    async function isValidIssue() {
      return systemFixture.navIssuanceModule.isValidIssue(matrixTokenAddress, reserveAsset, reserveQuantity);
    }

    it('should return true', async () => {
      const result = await isValidIssue();
      expect(result).is.true;
    });

    it('returns false when total supply is less than min required for NAV issuance', async () => {
      // Redeem below required
      await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(9.5), owner.address);
      const result = await isValidIssue();
      expect(result).is.false;
    });

    it('returns false when the issue quantity is 0', async () => {
      reserveQuantity = ZERO;
      const result = await isValidIssue();
      expect(result).is.false;
    });

    it('returns false when the reserve asset is not valid', async () => {
      reserveAsset = systemFixture.wbtc.address;
      const result = await isValidIssue();
      expect(result).is.false;
    });
  });

  describe('isRedeemValid', () => {
    let reserveAsset;
    let matrixTokenQuantity;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();

      const protocolDirectFee = ethToWei(0.02);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, THREE, protocolDirectFee);

      const protocolManagerFee = ethToWei(0.3);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ONE, protocolManagerFee);
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
      const uints = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)];
      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
      matrixToken = await systemFixture.createMatrixToken(components, uints, modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply to 1 unit
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
      await systemFixture.usdc.approve(systemFixture.basicIssuanceModule.address, usdToWei(1000000));
      await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(1000000));
      await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000000));

      // Seed with 10 supply
      await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
      await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(10), owner.address);

      reserveAsset = systemFixture.usdc.address;
      matrixTokenQuantity = ethToWei(1);
    });

    async function isValidRedeem() {
      return systemFixture.navIssuanceModule.isValidRedeem(matrixTokenAddress, reserveAsset, matrixTokenQuantity);
    }

    it('should return true', async () => {
      const result = await isValidRedeem();
      expect(result).is.true;
    });

    it('returns false when total supply is less than min required for NAV issuance', async () => {
      // Redeem below required
      await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(9), owner.address);
      matrixTokenQuantity = ethToWei(0.01);
      const result = await isValidRedeem();
      expect(result).is.false;
    });

    it('returns false when there is not sufficient reserve asset for withdraw', async () => {
      // Add self as module and update the position state
      await systemFixture.controller.addModule(owner.address);
      await matrixToken.connect(owner).addModule(owner.address);
      await matrixToken.connect(owner).initializeModule();

      // Remove USDC position
      await matrixToken.editDefaultPositionUnit(systemFixture.usdc.address, ZERO);

      matrixTokenQuantity = ethToWei(1);
      const result = await isValidRedeem();
      expect(result).is.false;
    });

    it('returns false when the redeem quantity is 0', async () => {
      matrixTokenQuantity = ZERO;
      const result = await isValidRedeem();
      expect(result).is.false;
    });

    it('returns false when the reserve asset is not valid', async () => {
      await systemFixture.wbtc.approve(systemFixture.controller.address, btcToWei(1000000));
      reserveAsset = systemFixture.wbtc.address;
      const result = await isValidRedeem();
      expect(result).is.false;
    });
  });

  describe('issue', () => {
    const units = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)]; // Valued at 2000 USDC

    let reserveAsset;
    let reserveQuantity;
    let minMatrixTokenReceived;
    let to;
    let navIssuanceSetting;
    let managerIssuanceHook;
    let managerFees;
    let premiumPercentage;
    let issueQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      revertBlockchain(snapshotId);
    });

    context('when there are 4 components and reserve asset is USDC', async () => {
      const initContracts = async () => {
        const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
        const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
        matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
        matrixTokenAddress = matrixToken.address;

        navIssuanceSetting = {
          managerIssuanceHook,
          managerRedemptionHook: await getRandomAddress(),
          reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          managerFees,
          maxManagerFee: ethToWei(0.2), // Set max managerFee to 20%
          premiumPercentage,
          maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
          minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply required
        };

        await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

        await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
        await systemFixture.usdc.approve(systemFixture.basicIssuanceModule.address, usdToWei(1000000));
        await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(1000000));
        await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000000));

        // Seed with 2 supply
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
        await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(2), owner.address);

        // Issue with 1000 USDC
        issueQuantity = usdToWei(1000);

        await systemFixture.usdc.approve(systemFixture.navIssuanceModule.address, issueQuantity);
      };

      const initVariables = () => {
        reserveAsset = systemFixture.usdc.address;
        reserveQuantity = issueQuantity;
        minMatrixTokenReceived = ethToWei(0);
        to = recipient;
        caller = owner;
      };

      context('case 1: when there are no fees and no issuance hooks', async () => {
        before(async () => {
          managerIssuanceHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0), ethToWei(0)]; // Set fees to 0
          premiumPercentage = ethToWei(0.005); // Set premium percentage to 50 bps
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();
        });

        async function issue() {
          return systemFixture.navIssuanceModule.connect(caller).issue(matrixTokenAddress, reserveAsset, reserveQuantity, minMatrixTokenReceived, to.address);
        }

        it('case 1: should issue the MatrixToken to the recipient', async () => {
          const expectedIssueQuantity = await getExpectedMatrixTokenIssueQuantity(
            matrixToken,
            systemFixture.matrixValuer,
            reserveAsset,
            usdToWei(1), // USDC base units 10^6
            reserveQuantity,
            managerFees[0],
            ZERO, // Protocol direct fee
            premiumPercentage
          );

          const oldBalance = await matrixToken.balanceOf(recipient.address);
          await issue();
          const newBalance = await matrixToken.balanceOf(recipient.address);

          expect(newBalance.sub(oldBalance)).eq(expectedIssueQuantity);
        });

        it('case 1: should have deposited the reserve asset into the MatrixToken', async () => {
          const oldBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          await issue();
          const newBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          expect(newBalance.sub(oldBalance)).eq(issueQuantity);
        });

        it('case 1: should have updated the reserve asset position correctly', async () => {
          const oldTotalSupply = await matrixToken.totalSupply();
          await issue();
          const newTotalSupply = await matrixToken.totalSupply();
          const positionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

          const newPositionMultiplier = await matrixToken.getPositionMultiplier(); // (Previous supply * previous units + current units) / current supply
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[1],
            issueQuantity,
            oldTotalSupply,
            newTotalSupply,
            newPositionMultiplier,
            managerFees[0],
            ZERO // Protocol fee percentage
          );

          expect(positionUnit).eq(expectedPositionUnit);
        });

        it('case 1: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldTotalSupply = await matrixToken.totalSupply();
          await issue();
          const newTotalSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTotalSupply, newTotalSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 1: should emit the IssueMatrixTokenNav event', async () => {
          const expectedTokenIssued = await systemFixture.navIssuanceModule.getExpectedMatrixTokenIssueQuantity(
            matrixTokenAddress,
            reserveAsset,
            reserveQuantity
          );
          await expect(issue())
            .emit(systemFixture.navIssuanceModule, 'IssueMatrixTokenNav')
            .withArgs(matrixTokenAddress, caller.address, to.address, reserveAsset, reserveQuantity, ZERO_ADDRESS, expectedTokenIssued, ZERO, ZERO);
        });

        it('case 1: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, issue, owner);
        });

        it('case 1: should revert when total supply is less than min required for NAV issuance', async () => {
          // Redeem below required
          await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(1.5), owner.address);
          await expect(issue()).revertedWith('N9a');
        });

        it('case 1: should revert when the issue quantity is 0', async () => {
          reserveQuantity = ZERO;
          await expect(issue()).revertedWith('N8a');
        });

        it('case 1: should revert when the reserve asset is not valid', async () => {
          await systemFixture.wbtc.approve(systemFixture.controller.address, btcToWei(1000000));
          reserveAsset = systemFixture.wbtc.address;
          await expect(issue()).revertedWith('N8b');
        });

        it('case 1: should revert when MatrixToken received is less than min required', async () => {
          minMatrixTokenReceived = ethToWei(100);
          await expect(issue()).revertedWith('N9b');
        });

        it('case 1: should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken(
            [systemFixture.weth.address],
            [ethToWei(1)],
            [systemFixture.navIssuanceModule.address],
            owner.address
          );
          matrixTokenAddress = newToken.address;
          await expect(issue()).revertedWith('M3');
        });

        describe('case 1.1: when the issue quantity is extremely small', () => {
          beforeEach(async () => {
            reserveQuantity = ONE;
          });

          it('case 1.1: should issue the Set to the recipient', async () => {
            const expectedIssueQuantity = await getExpectedMatrixTokenIssueQuantity(
              matrixToken,
              systemFixture.matrixValuer,
              reserveAsset,
              usdToWei(1), // USDC base units 10^6
              reserveQuantity,
              managerFees[0],
              ZERO, // Protocol direct fee
              premiumPercentage
            );

            const oldBalance = await matrixToken.balanceOf(recipient.address);
            await issue();
            const newBalance = await matrixToken.balanceOf(recipient.address);

            expect(newBalance.sub(oldBalance)).eq(expectedIssueQuantity);
          });

          it('case 1.1: should have deposited the reserve asset into the MatrixToken', async () => {
            const oldUsdcBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
            await issue();
            const newUsdcBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
            expect(newUsdcBalance.sub(oldUsdcBalance)).eq(reserveQuantity);
          });

          it('case 1.1: should have updated the reserve asset position correctly', async () => {
            const oldTotalSupply = await matrixToken.totalSupply();
            await issue();
            const newTotalSupply = await matrixToken.totalSupply();
            const usdcPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

            const newPositionMultiplier = await matrixToken.getPositionMultiplier(); // (Previous supply * previous units + current units) / current supply
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              units[1],
              reserveQuantity,
              oldTotalSupply,
              newTotalSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(usdcPositionUnit).eq(expectedPositionUnit);
          });

          it('case 1.1: should have updated the position multiplier correctly', async () => {
            const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
            const oldTotalSupply = await matrixToken.totalSupply();
            await issue();
            const newTotalSupply = await matrixToken.totalSupply();
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTotalSupply, newTotalSupply);
            expect(newPositionMultiplier).eq(expectedPositionMultiplier);
          });

          it('case 1.1: should reconcile balances', async () => {
            await reconcileBalances(matrixToken, issue, owner);
          });
        });

        describe('case 1.2: when a MatrixToken position is not in default state', () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await systemFixture.controller.addModule(owner.address);
            await matrixToken.connect(owner).addModule(owner.address);
            await matrixToken.connect(owner).initializeModule();
            await matrixToken.connect(owner).addExternalPositionModule(systemFixture.usdc.address, ZERO_ADDRESS);

            // Move default USDC to external position
            await matrixToken.editDefaultPositionUnit(systemFixture.usdc.address, ZERO);
            await matrixToken.editExternalPositionUnit(systemFixture.usdc.address, ZERO_ADDRESS, units[1]);
          });

          it('case 1.2: should have updated the reserve asset position correctly', async () => {
            const oldTotalSupply = await matrixToken.totalSupply();
            await issue();
            const newTotalSupply = await matrixToken.totalSupply();
            const defaultUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

            const newPositionMultiplier = await matrixToken.getPositionMultiplier(); // (Previous supply * previous units + current units) / current supply
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              ZERO, // Previous units are 0
              reserveQuantity,
              oldTotalSupply,
              newTotalSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(defaultUnit).eq(expectedPositionUnit);
          });

          it('case 1.2: should have updated the position multiplier correctly', async () => {
            const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
            const oldTotalSupply = await matrixToken.totalSupply();
            await issue();
            const newTotalSupply = await matrixToken.totalSupply();
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTotalSupply, newTotalSupply);
            expect(newPositionMultiplier).eq(expectedPositionMultiplier);
          });

          it('case 1.2: should reconcile balances', async () => {
            await reconcileBalances(matrixToken, issue, owner);
          });
        });
      });

      context('case 2: when there are fees enabled and no issuance hooks', async () => {
        let protocolDirectFee;
        let protocolManagerFee;

        before(async () => {
          managerIssuanceHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0.1), ethToWei(0.1)];
          premiumPercentage = ethToWei(0.005);
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();

          protocolDirectFee = ethToWei(0.02);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, TWO, protocolDirectFee);

          protocolManagerFee = ethToWei(0.3);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ZERO, protocolManagerFee);
        });

        async function issue() {
          return systemFixture.navIssuanceModule.connect(caller).issue(matrixTokenAddress, reserveAsset, reserveQuantity, minMatrixTokenReceived, to.address);
        }

        it('case 2: should issue the MatrixToken to the recipient', async () => {
          const expectedIssueQuantity = await getExpectedMatrixTokenIssueQuantity(
            matrixToken,
            systemFixture.matrixValuer,
            reserveAsset,
            usdToWei(1), // USDC base units 10^6
            reserveQuantity,
            managerFees[0],
            protocolDirectFee, // Protocol direct fee
            premiumPercentage
          );

          const oldBalance = await matrixToken.balanceOf(recipient.address);
          await issue();
          const newBalance = await matrixToken.balanceOf(recipient.address);
          expect(newBalance.sub(oldBalance)).eq(expectedIssueQuantity);
        });

        it('case 2: should have deposited the reserve asset into the MatrixToken', async () => {
          const oldUsdcBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          await issue();
          const newUsdcBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          const postFeeQuantity = getExpectedPostFeeQuantity(issueQuantity, managerFees[0], protocolDirectFee);
          expect(newUsdcBalance.sub(oldUsdcBalance)).eq(postFeeQuantity);
        });

        it('case 2: should have updated the reserve asset position correctly', async () => {
          const oldTotalSupply = await matrixToken.totalSupply();
          await issue();
          const newTotalSupply = await matrixToken.totalSupply();
          const usdcPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[1],
            issueQuantity,
            oldTotalSupply,
            newTotalSupply,
            newPositionMultiplier,
            managerFees[0],
            protocolDirectFee
          );

          expect(usdcPositionUnit).eq(expectedPositionUnit);
        });

        it('case 2: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldTotalSupply = await matrixToken.totalSupply();
          await issue();
          const newTotalSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTotalSupply, newTotalSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 2: should have properly distributed the protocol fee', async () => {
          const oldBalance = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
          await issue();
          const newBalance = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(reserveQuantity, protocolFeePercentage);
          expect(newBalance.sub(oldBalance)).eq(protocolFeeAmount);
        });

        it('case 2: should have properly distributed the management fee', async () => {
          const oldBalance = await systemFixture.usdc.balanceOf(feeRecipient.address);
          await issue();
          const newBalance = await systemFixture.usdc.balanceOf(feeRecipient.address);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, reserveQuantity);
          expect(newBalance.sub(oldBalance)).eq(managerFeeAmount);
        });

        it('case 2: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, issue, owner);
        });
      });

      context('case 3: when there are fees, premiums and an issuance hooks', async () => {
        let issuanceHookContract;

        before(async () => {
          managerIssuanceHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0), ethToWei(0)];
          premiumPercentage = ethToWei(0.005);

          issuanceHookContract = await deployContract('NavIssuanceHookMock');
          managerIssuanceHook = issuanceHookContract.address;
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();
        });

        async function issue() {
          return systemFixture.navIssuanceModule.issue(matrixTokenAddress, reserveAsset, reserveQuantity, minMatrixTokenReceived, to.address);
        }

        it('case 3: should properly call the pre-issue hooks', async () => {
          await issue();
          expect(await issuanceHookContract.getToken()).eq(matrixTokenAddress);
          expect(await issuanceHookContract.getReserveAsset()).eq(reserveAsset);
          expect(await issuanceHookContract.getReserveAssetQuantity()).eq(reserveQuantity);
          expect(await issuanceHookContract.getSender()).eq(owner.address);
          expect(await issuanceHookContract.getTo()).eq(to.address);
        });
      });
    });
  });

  describe('issueWithEther', () => {
    const units = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)]; // Valued at 2000 USDC

    let minMatrixTokenReceived;
    let to;
    let value;
    let navIssuanceSetting;
    let managerIssuanceHook;
    let managerFees;
    let premiumPercentage;
    let issueQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      revertBlockchain(snapshotId);
    });

    context('when there are 4 components and reserve asset is ETH', async () => {
      const initContracts = async () => {
        const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
        const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
        matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
        matrixTokenAddress = matrixToken.address;

        navIssuanceSetting = {
          managerIssuanceHook,
          managerRedemptionHook: await getRandomAddress(),
          reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          managerFees,
          maxManagerFee: ethToWei(0.2), // Set max managerFee to 20%
          premiumPercentage,
          maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
          minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply required
        };

        await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

        // Approve tokens to the controller
        await systemFixture.weth.approve(systemFixture.controller.address, ethToWei(100));
        await systemFixture.usdc.approve(systemFixture.controller.address, usdToWei(1000000));
        await systemFixture.wbtc.approve(systemFixture.controller.address, btcToWei(1000000));
        await systemFixture.dai.approve(systemFixture.controller.address, ethToWei(1000000));

        // Seed with 2 supply
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
        await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(2), owner.address);

        // Issue with 0.1 ETH
        issueQuantity = ethToWei(0.1);
      };

      const initVariables = () => {
        minMatrixTokenReceived = ethToWei(0);
        to = recipient;
        value = issueQuantity;
        caller = owner;
      };

      context('case 1: when there are no fees and no issuance hooks', async () => {
        before(async () => {
          managerIssuanceHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0), ethToWei(0)]; // Set fees to 0
          premiumPercentage = ethToWei(0.005);
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();
        });

        async function issueWithEther() {
          return systemFixture.navIssuanceModule.connect(caller).issueWithEther(matrixTokenAddress, minMatrixTokenReceived, to.address, {
            value: value,
          });
        }

        it('case 1: should issue the MatrixToken to the recipient', async () => {
          const expectedIssueQuantity = await getExpectedMatrixTokenIssueQuantity(
            matrixToken,
            systemFixture.matrixValuer,
            systemFixture.weth.address,
            ethToWei(1), // ETH base units 10^18
            value,
            managerFees[0],
            ZERO, // Protocol direct fee
            premiumPercentage
          );

          const oldBalance = await matrixToken.balanceOf(recipient.address);
          await issueWithEther();
          const newBalance = await matrixToken.balanceOf(recipient.address);

          expect(newBalance.sub(oldBalance)).eq(expectedIssueQuantity);
        });

        it('case 1: should have deposited WETH into the MatrixToken', async () => {
          const oldWETHBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          await issueWithEther();
          const newWETHBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          expect(newWETHBalance.sub(oldWETHBalance)).eq(issueQuantity);
        });

        it('case 1: should have updated the reserve asset position correctly', async () => {
          const oldTokenSupply = await matrixToken.totalSupply();
          await issueWithEther();
          const newTokenSupply = await matrixToken.totalSupply();

          const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(systemFixture.weth.address);
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[0],
            issueQuantity,
            oldTokenSupply,
            newTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            ZERO // Protocol fee percentage
          );

          expect(defaultPositionUnit).eq(expectedPositionUnit);
        });

        it('case 1: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldTokenSupply = await matrixToken.totalSupply();
          await issueWithEther();
          const newTokenSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTokenSupply, newTokenSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 1: should emit the IssueMatrixTokenNav event', async () => {
          const expectedTokenIssued = await systemFixture.navIssuanceModule.getExpectedMatrixTokenIssueQuantity(
            matrixTokenAddress,
            systemFixture.weth.address,
            value
          );
          await expect(issueWithEther())
            .emit(systemFixture.navIssuanceModule, 'IssueMatrixTokenNav')
            .withArgs(matrixTokenAddress, caller.address, to.address, systemFixture.weth.address, value, ZERO_ADDRESS, expectedTokenIssued, ZERO, ZERO);
        });

        it('case 1: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, issueWithEther, owner);
        });

        it('case 1: should revert when total supply is less than min required for NAV issuance', async () => {
          // Redeem below required
          await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(1.5), owner.address);
          await expect(issueWithEther()).revertedWith('N9a');
        });

        it('case 1: should revert when the value is 0', async () => {
          value = ZERO;
          await expect(issueWithEther()).revertedWith('N8a');
        });

        it('case 1: should revert when MatrixToken received is less than minimum', async () => {
          minMatrixTokenReceived = ethToWei(100);
          await expect(issueWithEther()).revertedWith('N9b');
        });

        it('case 1: should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken(
            [systemFixture.weth.address],
            [ethToWei(1)],
            [systemFixture.navIssuanceModule.address],
            owner.address
          );
          matrixTokenAddress = newToken.address;
          await expect(issueWithEther()).revertedWith('M3');
        });

        describe('case 1.1: when a MatrixToken position is not in default state', () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await systemFixture.controller.addModule(owner.address);
            matrixToken = matrixToken.connect(owner);
            await matrixToken.addModule(owner.address);
            await matrixToken.initializeModule();

            await matrixToken.addExternalPositionModule(systemFixture.weth.address, ZERO_ADDRESS);

            // Move default WETH to external position
            await matrixToken.editDefaultPositionUnit(systemFixture.weth.address, ZERO);
            await matrixToken.editExternalPositionUnit(systemFixture.weth.address, ZERO_ADDRESS, units[0]);
          });

          it('case 1.1: should have updated the reserve asset position correctly', async () => {
            const oldTokenSupply = await matrixToken.totalSupply();

            await issueWithEther();

            const newTokenSupply = await matrixToken.totalSupply();
            const defaultUnit = await matrixToken.getDefaultPositionRealUnit(systemFixture.weth.address);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              ZERO, // Previous units are 0
              value,
              oldTokenSupply,
              newTokenSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(defaultUnit).eq(expectedPositionUnit);
          });

          it('case 1.1: should have updated the position multiplier correctly', async () => {
            const oldTokenSupply = await matrixToken.totalSupply();
            const oldPositionMultiplier = await matrixToken.getPositionMultiplier();

            await issueWithEther();

            const newTokenSupply = await matrixToken.totalSupply();
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();

            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTokenSupply, newTokenSupply);
            expect(newPositionMultiplier).eq(expectedPositionMultiplier);
          });

          it('case 1.1: should reconcile balances', async () => {
            await reconcileBalances(matrixToken, issueWithEther, owner);
          });
        });
      });

      context('case 2: when there are fees enabled and no issuance hooks', async () => {
        let protocolDirectFee;
        let protocolManagerFee;

        before(async () => {
          managerIssuanceHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0.1), ethToWei(0.1)];
          premiumPercentage = ethToWei(0.1);
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();

          protocolDirectFee = ethToWei(0.02);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, TWO, protocolDirectFee);

          protocolManagerFee = ethToWei(0.3);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ZERO, protocolManagerFee);
        });

        async function issueWithEther() {
          return systemFixture.navIssuanceModule.connect(caller).issueWithEther(matrixTokenAddress, minMatrixTokenReceived, to.address, {
            value: value,
          });
        }

        it('case 2: should issue the MatrixToken to the recipient', async () => {
          const expectedIssueQuantity = await getExpectedMatrixTokenIssueQuantity(
            matrixToken,
            systemFixture.matrixValuer,
            systemFixture.weth.address,
            ethToWei(1), // ETH base units 10^18
            value,
            managerFees[0],
            protocolDirectFee, // Protocol direct fee
            premiumPercentage
          );

          await issueWithEther();

          const issuedBalance = await matrixToken.balanceOf(recipient.address);
          expect(issuedBalance).eq(expectedIssueQuantity);
        });

        it('case 2: should have deposited the reserve asset into the MatrixToken', async () => {
          const oldWETHBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          await issueWithEther();
          const newWETHBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          const expectedPostFeeQuantity = getExpectedPostFeeQuantity(issueQuantity, managerFees[0], protocolDirectFee);
          expect(newWETHBalance.sub(oldWETHBalance)).eq(expectedPostFeeQuantity);
        });

        it('case 2: should have updated the reserve asset position correctly', async () => {
          const oldTokenSupply = await matrixToken.totalSupply();
          await issueWithEther();
          const newTokenSupply = await matrixToken.totalSupply();
          const wethPositionUnit = await matrixToken.getDefaultPositionRealUnit(systemFixture.weth.address);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[0],
            issueQuantity,
            oldTokenSupply,
            newTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            protocolDirectFee
          );

          expect(wethPositionUnit).eq(expectedPositionUnit);
        });

        it('case 2: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldTokenSupply = await matrixToken.totalSupply();
          await issueWithEther();
          const newTokenSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldTokenSupply, newTokenSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 2: should have properly distributed the protocol fee in WETH', async () => {
          const oldProtocolFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
          await issueWithEther();
          const newProtocolFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);

          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(value, protocolFeePercentage);
          expect(newProtocolFeeRecipientBalance.sub(oldProtocolFeeRecipientBalance)).eq(protocolFeeAmount);
        });

        it('case 2: should have properly distributed the management fee in WETH', async () => {
          const oldManagerBalance = await systemFixture.weth.balanceOf(feeRecipient.address);
          await issueWithEther();
          const newManagerBalance = await systemFixture.weth.balanceOf(feeRecipient.address);

          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, value);
          expect(newManagerBalance.sub(oldManagerBalance)).eq(managerFeeAmount);
        });

        it('case 2: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, issueWithEther, owner);
        });
      });
    });
  });

  describe('redeem', () => {
    const units = [ethToWei(1), usdToWei(570), btcToWei(1).div(10), ethToWei(300)]; // Valued at 2000 USDC

    let reserveAsset;
    let matrixTokenQuantity;
    let minReserveQuantityReceived;
    let to;
    let navIssuanceSetting;
    let managerRedemptionHook;
    let managerFees;
    let premiumPercentage;
    let redeemQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      revertBlockchain(snapshotId);
    });

    context('when there are 4 components and reserve asset is USDC', async () => {
      const initContracts = async () => {
        const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
        const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
        matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);

        navIssuanceSetting = {
          managerIssuanceHook: await getRandomAddress(),
          managerRedemptionHook,
          reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          managerFees,
          maxManagerFee: ethToWei(0.2), // Set max managerFee to 20%
          premiumPercentage,
          maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
          minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply required
        };

        await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

        // Approve tokens to the controller
        await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
        await systemFixture.usdc.approve(systemFixture.basicIssuanceModule.address, usdToWei(1000000));
        await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(1000000));
        await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000000));

        // Seed with 10 supply
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
        await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(10), owner.address);

        // Redeem 1 MatrixToken
        redeemQuantity = ethToWei(2.8);
      };

      const initVariables = () => {
        matrixTokenAddress = matrixToken.address;
        reserveAsset = systemFixture.usdc.address;
        matrixTokenQuantity = redeemQuantity;
        minReserveQuantityReceived = ethToWei(0);
        to = recipient;
        caller = owner;
      };

      context('case 1: when there are no fees and no redemption hooks', async () => {
        before(async () => {
          managerRedemptionHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0), ethToWei(0)]; // Set fees to 0
          premiumPercentage = ethToWei(0.005); // Set premium percentage to 50 bps
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();
        });

        async function redeem() {
          return systemFixture.navIssuanceModule
            .connect(caller)
            .redeem(matrixTokenAddress, reserveAsset, matrixTokenQuantity, minReserveQuantityReceived, to.address);
        }

        it('case 1: should reduce the MatrixToken supply', async () => {
          const oldBalance = await matrixToken.balanceOf(owner.address);
          const oldSupply = await matrixToken.totalSupply();
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const newBalance = await matrixToken.balanceOf(owner.address);
          expect(oldBalance.sub(newBalance)).eq(oldSupply.sub(newSupply));
        });

        it('case 1: should have redeemed the reserve asset to the recipient', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            usdToWei(1), // USDC base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );

          const oldBalance = await systemFixture.usdc.balanceOf(recipient.address);
          await redeem();
          const newBalance = await systemFixture.usdc.balanceOf(recipient.address);

          expect(newBalance.sub(oldBalance)).eq(expectedRedeemQuantity);
        });

        it('case 1: should have updated the reserve asset position correctly', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          const oldSupply = await matrixToken.totalSupply();
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[1],
            redeemQuantity,
            matrixTokenValuation,
            usdToWei(1), // USDC base units
            oldSupply,
            newSupply,
            newPositionMultiplier,
            premiumPercentage
          );

          expect(defaultPositionUnit).eq(expectedPositionUnit);
        });

        it('case 1: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldSupply = await matrixToken.totalSupply();
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 1: should emit the RedeemMatrixTokenNav event', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            usdToWei(1), // USDC base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );

          await expect(redeem())
            .emit(systemFixture.navIssuanceModule, 'RedeemMatrixTokenNav')
            .withArgs(matrixTokenAddress, caller.address, to.address, reserveAsset, expectedRedeemQuantity, ZERO_ADDRESS, matrixTokenQuantity, ZERO, ZERO);
        });

        it('case 1: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, redeem, owner);
        });

        it('case 1: should revert when total supply is less than min required for NAV issuance', async () => {
          // Redeem below required
          await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(9), owner.address);
          matrixTokenQuantity = ethToWei(0.01);
          await expect(redeem()).revertedWith('N10a');
        });

        it('case 1: should revert when there is not sufficient reserve asset for withdraw', async () => {
          // Add self as module and update the position state
          await systemFixture.controller.addModule(owner.address);
          await matrixToken.connect(owner).addModule(owner.address);
          await matrixToken.connect(owner).initializeModule();

          // Remove USDC position
          await matrixToken.connect(owner).editDefaultPositionUnit(systemFixture.usdc.address, ZERO);

          matrixTokenQuantity = ethToWei(1);
          await expect(redeem()).revertedWith('N11');
        });

        it('case 1: should revert when the redeem quantity is 0', async () => {
          matrixTokenQuantity = ZERO;
          await expect(redeem()).revertedWith('N8a');
        });

        it('case 1: should revert when the reserve asset is not valid', async () => {
          await systemFixture.wbtc.approve(systemFixture.controller.address, btcToWei(1000000));
          reserveAsset = systemFixture.wbtc.address;
          await expect(redeem()).revertedWith('N8b');
        });

        it('case 1: should revert when reserve asset received is less than min required', async () => {
          minReserveQuantityReceived = ethToWei(100);
          await expect(redeem()).revertedWith('N10b');
        });

        it('case 1: should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken(
            [systemFixture.weth.address],
            [ethToWei(1)],
            [systemFixture.navIssuanceModule.address],
            owner.address
          );
          matrixTokenAddress = newToken.address;
          await expect(redeem()).revertedWith('M3');
        });

        describe('case 1.1: when the redeem quantity is extremely small', () => {
          beforeEach(async () => {
            matrixTokenQuantity = ONE;
          });

          it('case 1.1: should reduce the MatrixToken supply', async () => {
            const oldBalance = await matrixToken.balanceOf(owner.address);
            const oldSupply = await matrixToken.totalSupply();
            await redeem();
            const newSupply = await matrixToken.totalSupply();
            const newBalance = await matrixToken.balanceOf(owner.address);
            expect(oldBalance.sub(newBalance)).eq(oldSupply.sub(newSupply));
          });

          it('case 1.1: should have redeemed the reserve asset to the recipient', async () => {
            const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
            const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
              matrixTokenQuantity,
              matrixTokenValuation,
              usdToWei(1), // USDC base units
              managerFees[1],
              ZERO, // Protocol fee percentage
              premiumPercentage
            );

            const oldUsdcBalance = await systemFixture.usdc.balanceOf(recipient.address);
            await redeem();
            const newUsdcBalance = await systemFixture.usdc.balanceOf(recipient.address);

            expect(newUsdcBalance.sub(oldUsdcBalance)).eq(expectedRedeemQuantity);
          });

          it('case 1.1: should have updated the reserve asset position correctly', async () => {
            const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
            const oldSupply = await matrixToken.totalSupply();
            await redeem();
            const newSupply = await matrixToken.totalSupply();
            const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionUnit = getExpectedRedeemPositionUnit(
              units[1],
              matrixTokenQuantity,
              matrixTokenValuation,
              usdToWei(1), // USDC base units
              oldSupply,
              newSupply,
              newPositionMultiplier,
              premiumPercentage
            );

            expect(defaultPositionUnit).eq(expectedPositionUnit);
          });

          it('case 1.1: should have updated the position multiplier correctly', async () => {
            const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
            const oldSupply = await matrixToken.totalSupply();
            await redeem();
            const newSupply = await matrixToken.totalSupply();
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
            expect(newPositionMultiplier).eq(expectedPositionMultiplier);
          });

          it('case 1.1: should reconcile balances', async () => {
            await reconcileBalances(matrixToken, redeem, owner);
          });
        });

        describe('case 1.2: when a MatrixToken position is not in default state', () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await systemFixture.controller.addModule(owner.address);
            await matrixToken.connect(owner).addModule(owner.address);
            await matrixToken.connect(owner).initializeModule();
            await matrixToken.addExternalPositionModule(systemFixture.usdc.address, ZERO_ADDRESS);

            // Convert half of default position to external position
            await matrixToken.connect(owner).editDefaultPositionUnit(systemFixture.usdc.address, units[1].div(2));
            await matrixToken.connect(owner).editExternalPositionUnit(systemFixture.usdc.address, ZERO_ADDRESS, units[1].div(2));

            matrixTokenQuantity = ethToWei(0.1);
          });

          it('case 1.2: should have updated the reserve asset position correctly', async () => {
            const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
            const oldSupply = await matrixToken.totalSupply();
            await redeem();
            const newSupply = await matrixToken.totalSupply();
            const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionUnit = getExpectedRedeemPositionUnit(
              units[1].div(2),
              matrixTokenQuantity,
              matrixTokenValuation,
              usdToWei(1), // USDC base units
              oldSupply,
              newSupply,
              newPositionMultiplier,
              premiumPercentage
            );

            expect(defaultPositionUnit).eq(expectedPositionUnit);
          });

          it('case 1.2: should have updated the position multiplier correctly', async () => {
            const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
            const oldSupply = await matrixToken.totalSupply();
            await redeem();
            const newSupply = await matrixToken.totalSupply();
            const newPositionMultiplier = await matrixToken.getPositionMultiplier();
            const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
            expect(newPositionMultiplier).eq(expectedPositionMultiplier);
          });

          it('case 1.2: should reconcile balances', async () => {
            await reconcileBalances(matrixToken, redeem, owner);
          });
        });
      });

      context('case 2: when there are fees enabled and no redemption hooks', async () => {
        let protocolDirectFee;
        let protocolManagerFee;

        before(async () => {
          managerRedemptionHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0.1), ethToWei(0.1)];
          premiumPercentage = ethToWei(0.005);
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();

          protocolDirectFee = ethToWei(0.02);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, THREE, protocolDirectFee);

          protocolManagerFee = ethToWei(0.3);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ONE, protocolManagerFee);
        });

        async function redeem() {
          return systemFixture.navIssuanceModule
            .connect(caller)
            .redeem(matrixTokenAddress, reserveAsset, matrixTokenQuantity, minReserveQuantityReceived, to.address);
        }

        it('case 2: should reduce the MatrixToken supply in', async () => {
          const oldSupply = await matrixToken.totalSupply();
          const oldBalance = await matrixToken.balanceOf(owner.address);
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const newBalance = await matrixToken.balanceOf(owner.address);

          expect(oldBalance.sub(newBalance)).eq(oldSupply.sub(newSupply));
        });

        it('case 2: should have redeemed the reserve asset to the recipient', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            usdToWei(1), // USDC base units
            managerFees[1],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          );

          const oldUsdcBalance = await systemFixture.usdc.balanceOf(recipient.address);
          await redeem();
          const newUsdcBalance = await systemFixture.usdc.balanceOf(recipient.address);

          expect(newUsdcBalance.sub(oldUsdcBalance)).eq(expectedRedeemQuantity);
        });

        it('case 2: should have updated the reserve asset position correctly', async () => {
          const oldSupply = await matrixToken.totalSupply();
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(reserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[1],
            redeemQuantity,
            matrixTokenValuation,
            usdToWei(1), // USDC base units
            oldSupply,
            newSupply,
            newPositionMultiplier,
            premiumPercentage
          );

          expect(defaultPositionUnit).eq(expectedPositionUnit);
        });

        it('case 2: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldSupply = await matrixToken.totalSupply();
          await redeem();
          const newSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 2: should have properly distributed the protocol fee', async () => {
          const oldProtocolFeeRecipientBalance = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
          const oldMatrixTokenBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          await redeem();
          const newMatrixTokenBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          const newProtocolFeeRecipientBalance = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);

          const redeemedReserveAssetAmount = oldMatrixTokenBalance.sub(newMatrixTokenBalance);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(redeemedReserveAssetAmount, protocolFeePercentage);
          expect(newProtocolFeeRecipientBalance.sub(oldProtocolFeeRecipientBalance)).eq(protocolFeeAmount);
        });

        it('case 2: should have properly distributed the management fee', async () => {
          const oldMatrixTokenBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          const oldFeeRecipientBalance = await systemFixture.usdc.balanceOf(feeRecipient.address);
          await redeem();
          const newMatrixTokenBalance = await systemFixture.usdc.balanceOf(matrixToken.address);
          const newFeeRecipientBalance = await systemFixture.usdc.balanceOf(feeRecipient.address);

          const redeemedReserveAssetAmount = oldMatrixTokenBalance.sub(newMatrixTokenBalance);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, redeemedReserveAssetAmount);
          expect(newFeeRecipientBalance.sub(oldFeeRecipientBalance)).eq(managerFeeAmount);
        });

        it('case 2: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, redeem, owner);
        });
      });

      context('case 3: when there are fees, premiums and an redemption hook', async () => {
        let issuanceHookContract; // ManagerIssuanceHookMock;

        beforeEach(async () => {
          managerFees = [ethToWei(0), ethToWei(0)];
          premiumPercentage = ethToWei(0.005);

          issuanceHookContract = await deployContract('ManagerIssuanceHookMock', [], owner);
          managerRedemptionHook = issuanceHookContract.address;
          await initContracts();
          initVariables();
        });

        async function redeem() {
          return systemFixture.navIssuanceModule
            .connect(caller)
            .redeem(matrixTokenAddress, reserveAsset, matrixTokenQuantity, minReserveQuantityReceived, to.address);
        }

        it('case 3: should properly call the pre-issue hooks', async () => {
          await redeem();
          expect(await issuanceHookContract.getToken()).eq(matrixTokenAddress);
          expect(await issuanceHookContract.getQuantity()).eq(matrixTokenQuantity);
          expect(await issuanceHookContract.getSender()).eq(owner.address);
          expect(await issuanceHookContract.getTo()).eq(to.address);
        });
      });
    });
  });

  describe('redeemIntoEther', () => {
    const units = [ethToWei(1), usdToWei(270), btcToWei(1).div(10), ethToWei(600)]; // Valued at 2000 USDC

    let matrixToken;
    let matrixTokenQuantity;
    let minReserveQuantityReceived;
    let to;
    let navIssuanceSetting;
    let managerRedemptionHook;
    let managerFees;
    let premiumPercentage;
    let redeemQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      revertBlockchain(snapshotId);
    });

    context('when there are 4 components and reserve asset is USDC', async () => {
      const initContracts = async () => {
        const components = [systemFixture.weth.address, systemFixture.usdc.address, systemFixture.wbtc.address, systemFixture.dai.address];
        const modules = [systemFixture.basicIssuanceModule.address, systemFixture.navIssuanceModule.address];
        matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
        matrixTokenAddress = matrixToken.address;

        navIssuanceSetting = {
          managerIssuanceHook: await getRandomAddress(),
          managerRedemptionHook,
          reserveAssets: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          managerFees,
          maxManagerFee: ethToWei(0.2), // Set max managerFee to 20%
          premiumPercentage,
          maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
          minMatrixTokenSupply: ethToWei(1), // Set min MatrixToken supply required
        };

        await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

        // Approve tokens to the controller
        await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
        await systemFixture.usdc.approve(systemFixture.basicIssuanceModule.address, usdToWei(1000000));
        await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(1000000));
        await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000000));

        // Seed with 10 supply
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, ZERO_ADDRESS);
        await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(10), owner.address);

        // Redeem 1 MatrixToken
        redeemQuantity = ethToWei(1);
      };

      const initVariables = () => {
        matrixTokenAddress = matrixToken.address;
        matrixTokenQuantity = redeemQuantity;
        minReserveQuantityReceived = ethToWei(0);
        to = recipient;
        caller = owner;
      };

      context('case 1: when there are no fees and no redemption hooks', async () => {
        before(async () => {
          managerRedemptionHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0), ethToWei(0)]; // Set fees to 0
          premiumPercentage = ethToWei(0.005); // Set premium percentage to 50 bps
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();
        });

        async function redeemIntoEther() {
          return systemFixture.navIssuanceModule
            .connect(caller)
            .redeemIntoEther(matrixTokenAddress, matrixTokenQuantity, minReserveQuantityReceived, to.address);
        }

        it('case 1: should reduce the MatrixToken supply', async () => {
          const oldBalance = await matrixToken.balanceOf(owner.address);
          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();
          const newBalance = await matrixToken.balanceOf(owner.address);
          expect(oldBalance.sub(newBalance)).eq(oldSupply.sub(newSupply));
        });

        it('case 1: should have redeemed the reserve asset to the recipient', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, systemFixture.weth.address);
          const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            ethToWei(1), // ETH base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );

          const oldEthBalance = await getEthBalance(recipient.address);
          await redeemIntoEther();
          const newEthBalance = await getEthBalance(recipient.address);

          expect(newEthBalance.sub(oldEthBalance)).eq(expectedRedeemQuantity);
        });

        it('case 1: should have updated the reserve asset position correctly', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, systemFixture.weth.address);

          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();

          const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(systemFixture.weth.address);
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[0],
            redeemQuantity,
            matrixTokenValuation,
            ethToWei(1), // ETH base units
            oldSupply,
            newSupply,
            newPositionMultiplier,
            premiumPercentage
          );

          expect(defaultPositionUnit).eq(expectedPositionUnit);
        });

        it('case 1: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 1: should emit the RedeemMatrixTokenNav event', async () => {
          const reserveAsset = systemFixture.weth.address;
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, reserveAsset);
          const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            ethToWei(1), // ETH base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );

          await expect(redeemIntoEther())
            .emit(systemFixture.navIssuanceModule, 'RedeemMatrixTokenNav')
            .withArgs(
              matrixTokenAddress,
              caller.address,
              to.address,
              systemFixture.weth.address,
              expectedRedeemQuantity,
              ZERO_ADDRESS,
              matrixTokenQuantity,
              ZERO,
              ZERO
            );
        });

        it('case 1: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, redeemIntoEther, owner);
        });

        it('case 1: should revert when total supply is less than min required for NAV issuance', async () => {
          // Redeem below required
          await systemFixture.basicIssuanceModule.connect(owner).redeem(matrixToken.address, ethToWei(9), owner.address);
          matrixTokenQuantity = ethToWei(0.01);
          await expect(redeemIntoEther()).revertedWith('N10a');
        });

        it('case 1: should revert when there is not sufficient reserve asset for withdraw', async () => {
          // Add self as module and update the position state
          await systemFixture.controller.addModule(owner.address);
          await matrixToken.connect(owner).addModule(owner.address);
          await matrixToken.connect(owner).initializeModule();

          // Remove WETH position
          await matrixToken.connect(owner).editDefaultPositionUnit(systemFixture.weth.address, ZERO);

          matrixTokenQuantity = ethToWei(1);
          await expect(redeemIntoEther()).revertedWith('N11');
        });

        it('case 1: should revert when the redeem quantity is 0', async () => {
          matrixTokenQuantity = ZERO;
          await expect(redeemIntoEther()).revertedWith('N8a');
        });

        it('case 1: should revert when reserve asset received is less than min required', async () => {
          minReserveQuantityReceived = ethToWei(100);
          await expect(redeemIntoEther()).revertedWith('N10b');
        });

        it('case 1: should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken(
            [systemFixture.weth.address],
            [ethToWei(1)],
            [systemFixture.navIssuanceModule.address],
            owner.address
          );
          matrixTokenAddress = newToken.address;
          await expect(redeemIntoEther()).revertedWith('M3');
        });
      });

      context('case 2: when there are fees enabled and no redemption hooks', async () => {
        let protocolDirectFee;
        let protocolManagerFee;

        before(async () => {
          managerRedemptionHook = ZERO_ADDRESS;
          managerFees = [ethToWei(0.1), ethToWei(0.1)];
          premiumPercentage = ethToWei(0.005);
        });

        beforeEach(async () => {
          await initContracts();
          initVariables();

          protocolDirectFee = ethToWei(0.02);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, THREE, protocolDirectFee);

          protocolManagerFee = ethToWei(0.3);
          await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ONE, protocolManagerFee);
        });

        async function redeemIntoEther() {
          return systemFixture.navIssuanceModule
            .connect(caller)
            .redeemIntoEther(matrixTokenAddress, matrixTokenQuantity, minReserveQuantityReceived, to.address);
        }

        it('case 2: should reduce the MatrixToken supply', async () => {
          const oldBalance = await matrixToken.balanceOf(owner.address);
          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();
          const newBalance = await matrixToken.balanceOf(owner.address);
          expect(oldBalance.sub(newBalance)).eq(oldSupply.sub(newSupply));
        });

        it('case 2: should have redeemed the reserve asset to the recipient', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, systemFixture.weth.address);

          const oldEthBalance = await getEthBalance(recipient.address);
          await redeemIntoEther();
          const newEthBalance = await getEthBalance(recipient.address);

          const expectedETHBalance = getExpectedReserveRedeemQuantity(
            matrixTokenQuantity,
            matrixTokenValuation,
            ethToWei(1), // ETH base units
            managerFees[1],
            protocolDirectFee, // Protocol direct fee percentage
            premiumPercentage
          );

          expect(newEthBalance.sub(oldEthBalance)).eq(expectedETHBalance);
        });

        it('case 2: should have updated the reserve asset position correctly', async () => {
          const matrixTokenValuation = await systemFixture.matrixValuer.calculateMatrixTokenValuation(matrixTokenAddress, systemFixture.weth.address);

          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();

          const defaultPositionUnit = await matrixToken.getDefaultPositionRealUnit(systemFixture.weth.address);

          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[0],
            redeemQuantity,
            matrixTokenValuation,
            ethToWei(1), // ETH base units
            oldSupply,
            newSupply,
            newPositionMultiplier,
            premiumPercentage
          );

          expect(defaultPositionUnit).eq(expectedPositionUnit);
        });

        it('case 2: should have updated the position multiplier correctly', async () => {
          const oldPositionMultiplier = await matrixToken.getPositionMultiplier();
          const oldSupply = await matrixToken.totalSupply();
          await redeemIntoEther();
          const newSupply = await matrixToken.totalSupply();
          const newPositionMultiplier = await matrixToken.getPositionMultiplier();
          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply);
          expect(newPositionMultiplier).eq(expectedPositionMultiplier);
        });

        it('case 2: should have properly distributed the protocol fee in WETH', async () => {
          const oldProtocolFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
          const oldMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          await redeemIntoEther();
          const newMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          const newProtocolFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);

          const redeemedReserveAssetAmount = oldMatrixTokenBalance.sub(newMatrixTokenBalance);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(redeemedReserveAssetAmount, protocolFeePercentage);
          expect(newProtocolFeeRecipientBalance.sub(oldProtocolFeeRecipientBalance)).eq(protocolFeeAmount);
        });

        it('case 2: should have properly distributed the management fee in WETH', async () => {
          const oldMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          const oldManagerBalance = await systemFixture.weth.balanceOf(feeRecipient.address);
          await redeemIntoEther();
          const newManagerBalance = await systemFixture.weth.balanceOf(feeRecipient.address);
          const newMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixToken.address);

          const redeemedReserveAssetAmount = oldMatrixTokenBalance.sub(newMatrixTokenBalance);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, redeemedReserveAssetAmount);
          expect(newManagerBalance.sub(oldManagerBalance)).eq(managerFeeAmount);
        });

        it('case 2: should reconcile balances', async () => {
          await reconcileBalances(matrixToken, redeemIntoEther, owner);
        });
      });
    });
  });

  context('Manager admin functions', async () => {
    function shouldRevertIfTheCallerIsNotTheManager(testFun) {
      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(testFun()).revertedWith('M1a');
      });
    }

    function shouldRevertIfMatrixTokenIsInvalid(testFun) {
      it('should revert when the MatrixToken is not enabled on the controller', async () => {
        const newToken = await systemFixture.createRawMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.navIssuanceModule.address],
          owner.address
        );
        matrixTokenAddress = newToken.address;
        await expect(testFun()).revertedWith('M1b');
      });
    }

    function shouldRevertIfModuleDisabled(testFun) {
      it('should revert when the module is disabled', async () => {
        await matrixToken.removeModule(systemFixture.navIssuanceModule.address);
        await expect(testFun()).revertedWith('M1b');
      });
    }

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.navIssuanceModule.address],
        owner.address
      );

      const navIssuanceSetting = {
        managerIssuanceHook: await getRandomAddress(),
        managerRedemptionHook: await getRandomAddress(),
        reserveAssets: [systemFixture.weth.address, systemFixture.usdc.address],
        feeRecipient: feeRecipient.address,
        managerFees: [ethToWei(0.001), ethToWei(0.002)], // Set manager issue fee to 0.1% and redeem to 0.2%
        maxManagerFee: ethToWei(0.02), // Set max managerFee to 2%
        premiumPercentage: ethToWei(0.01), // Set premium to 1%
        maxPremiumPercentage: ethToWei(0.1), // Set max premium to 10%
        minMatrixTokenSupply: ethToWei(100), // Set min MatrixToken supply to 100 units
      };

      await systemFixture.navIssuanceModule.initialize(matrixToken.address, navIssuanceSetting);

      const protocolDirectFee = ethToWei(0.02);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ethToWei(0.3);
      await systemFixture.controller.addFee(systemFixture.navIssuanceModule.address, ZERO, protocolManagerFee);
    });

    afterEach(async () => {
      revertBlockchain(snapshotId);
    });

    describe('addReserveAsset', () => {
      let reserveAsset;

      beforeEach(async () => {
        matrixTokenAddress = matrixToken.address;
        reserveAsset = systemFixture.dai.address;
        caller = owner;
      });

      async function addReserveAsset() {
        return systemFixture.navIssuanceModule.connect(caller).addReserveAsset(matrixTokenAddress, reserveAsset);
      }

      it('should add the reserve asset', async () => {
        await addReserveAsset();
        const reserveAssets = await systemFixture.navIssuanceModule.getReserveAssets(matrixTokenAddress);
        expect(reserveAssets.length).eq(3);
        const isReserveAssetAdded = await systemFixture.navIssuanceModule.isReserveAsset(matrixTokenAddress, reserveAsset);
        expect(isReserveAssetAdded).is.true;
      });

      it('should emit correct AddReserveAsset event', async () => {
        await expect(addReserveAsset()).emit(systemFixture.navIssuanceModule, 'AddReserveAsset').withArgs(matrixTokenAddress, reserveAsset);
      });

      it('should revert when the reserve asset exists', async () => {
        reserveAsset = systemFixture.weth.address;
        await expect(addReserveAsset()).revertedWith('N2');
      });

      shouldRevertIfTheCallerIsNotTheManager(addReserveAsset);
      shouldRevertIfMatrixTokenIsInvalid(addReserveAsset);
      shouldRevertIfModuleDisabled(addReserveAsset);
    });

    describe('removeReserveAsset', () => {
      let reserveAsset;

      beforeEach(async () => {
        matrixTokenAddress = matrixToken.address;
        reserveAsset = systemFixture.usdc.address;
        caller = owner;
      });

      async function removeReserveAsset() {
        return systemFixture.navIssuanceModule.connect(caller).removeReserveAsset(matrixTokenAddress, reserveAsset);
      }

      it('should remove the reserve asset', async () => {
        await removeReserveAsset();
        const isReserveAsset = await systemFixture.navIssuanceModule.isReserveAsset(matrixTokenAddress, reserveAsset);
        const reserveAssets = await systemFixture.navIssuanceModule.getReserveAssets(matrixTokenAddress);

        expect(isReserveAsset).is.false;
        expect(JSON.stringify(reserveAssets)).eq(JSON.stringify([systemFixture.weth.address]));
      });

      it('should emit correct RemoveReserveAsset event', async () => {
        await expect(removeReserveAsset()).emit(systemFixture.navIssuanceModule, 'RemoveReserveAsset').withArgs(matrixTokenAddress, reserveAsset);
      });

      it('should revert when the reserve asset does not exist', async () => {
        reserveAsset = systemFixture.wbtc.address;
        await expect(removeReserveAsset()).revertedWith('N4');
      });

      shouldRevertIfTheCallerIsNotTheManager(removeReserveAsset);
      shouldRevertIfMatrixTokenIsInvalid(removeReserveAsset);
      shouldRevertIfModuleDisabled(removeReserveAsset);
    });

    describe('editPremium', () => {
      let premium;

      beforeEach(async () => {
        matrixTokenAddress = matrixToken.address;
        premium = ethToWei(0.02);
        caller = owner;
      });

      async function editPremium() {
        return systemFixture.navIssuanceModule.connect(caller).editPremium(matrixTokenAddress, premium);
      }

      it('should edit the premium', async () => {
        await editPremium();
        const retrievedPremium = await systemFixture.navIssuanceModule.getIssuePremium(matrixTokenAddress, ZERO_ADDRESS, ZERO);
        expect(retrievedPremium).eq(premium);
      });

      it('should emit correct EditPremium event', async () => {
        await expect(editPremium()).emit(systemFixture.navIssuanceModule, 'EditPremium').withArgs(matrixTokenAddress, premium);
      });

      it('should revert when the premium is greater than maximum allowed', async () => {
        premium = ethToWei(1);
        await expect(editPremium()).revertedWith('N5');
      });

      shouldRevertIfTheCallerIsNotTheManager(editPremium);
      shouldRevertIfMatrixTokenIsInvalid(editPremium);
      shouldRevertIfModuleDisabled(editPremium);
    });

    describe('editManagerFee', () => {
      let managerFee;
      let feeIndex;

      beforeEach(async () => {
        matrixTokenAddress = matrixToken.address;
        managerFee = ethToWei(0.01);
        feeIndex = ZERO;
        caller = owner;
      });

      async function editManagerFee() {
        return systemFixture.navIssuanceModule.connect(caller).editManagerFee(matrixTokenAddress, managerFee, feeIndex);
      }

      it('should edit the manager issue fee', async () => {
        await editManagerFee();
        const managerIssueFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, feeIndex);
        expect(managerIssueFee).eq(managerFee);
      });

      it('should emit correct EditManagerFee event', async () => {
        await expect(editManagerFee()).emit(systemFixture.navIssuanceModule, 'EditManagerFee').withArgs(matrixTokenAddress, managerFee, feeIndex);
      });

      it('should edit the manager redeem fee when editing the redeem fee', async () => {
        managerFee = ethToWei(0.002);
        feeIndex = ONE;
        await editManagerFee();
        const managerRedeemFee = await systemFixture.navIssuanceModule.getManagerFee(matrixTokenAddress, feeIndex);
        expect(managerRedeemFee).eq(managerFee);
      });

      it('should revert when the manager fee is greater than maximum allowed', async () => {
        managerFee = ethToWei(1);
        await expect(editManagerFee()).revertedWith('N6');
      });

      shouldRevertIfTheCallerIsNotTheManager(editManagerFee);
      shouldRevertIfMatrixTokenIsInvalid(editManagerFee);
      shouldRevertIfModuleDisabled(editManagerFee);
    });

    describe('editFeeRecipient', () => {
      let feeRecipientAddress;

      beforeEach(async () => {
        matrixTokenAddress = matrixToken.address;
        feeRecipientAddress = feeRecipient.address;
        caller = owner;
      });

      async function editFeeRecipient() {
        return systemFixture.navIssuanceModule.connect(caller).editFeeRecipient(matrixTokenAddress, feeRecipientAddress);
      }

      it('should edit the manager fee recipient', async () => {
        await editFeeRecipient();
        const navIssuanceSetting = await systemFixture.navIssuanceModule.getIssuanceSetting(matrixTokenAddress);
        expect(navIssuanceSetting.feeRecipient).eq(feeRecipientAddress);
      });

      it('should emit correct EditFeeRecipient event', async () => {
        await expect(editFeeRecipient()).emit(systemFixture.navIssuanceModule, 'EditFeeRecipient').withArgs(matrixTokenAddress, feeRecipientAddress);
      });

      it('should revert when the manager fee is greater than maximum allowed', async () => {
        feeRecipientAddress = ZERO_ADDRESS;
        await expect(editFeeRecipient()).revertedWith('N7');
      });

      shouldRevertIfTheCallerIsNotTheManager(editFeeRecipient);
      shouldRevertIfMatrixTokenIsInvalid(editFeeRecipient);
      shouldRevertIfModuleDisabled(editFeeRecipient);
    });
  });
});
