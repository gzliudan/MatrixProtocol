// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../../../helpers/unitUtil');
const { getSigners } = require('../../../helpers/accountUtil');
const { AaveV2Fixture } = require('../../../fixtures/aaveV2Fixture');
const { SystemFixture } = require('../../../fixtures/systemFixture');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');
const { ZERO, ONE, TWO, MAX_UINT_256, ZERO_ADDRESS } = require('../../../helpers/constants');
const { deployContract, deployContractAndLinkLibraries } = require('../../../helpers/deploy');

describe('library AaveV2', function () {
  const [owner, protocolFeeRecipient] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const aaveV2Fixture = new AaveV2Fixture(owner);
  const stableInterestRateMode = ONE;
  const variableInterestRateMode = TWO;
  const amountNotional = ethToWei(1);

  let aaveLib; // AaveV2
  let aaveLibMock; // AaveV2Mock
  let invokeLibMock; // InvokeMock
  let aWETH; // Aave V2 AToken;
  let stableDebtDAI; // Aave V2 StableDebtToken
  let variableDebtDAI; // Aave V2 VariableDebtToken
  let matrixToken;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();

    await aaveV2Fixture.init(systemFixture.weth.address, systemFixture.dai.address);
    aWETH = aaveV2Fixture.wethReserveTokens.aToken;
    stableDebtDAI = aaveV2Fixture.daiReserveTokens.stableDebtToken;
    variableDebtDAI = aaveV2Fixture.daiReserveTokens.variableDebtToken;

    // add liquidity
    await systemFixture.weth.connect(owner).approve(aaveV2Fixture.lendingPool.address, ethToWei(100));
    await systemFixture.dai.connect(owner).approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
    await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(100), owner.address, ZERO);
    await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.dai.address, ethToWei(1000), owner.address, ZERO);

    aaveLib = await deployContract('AaveV2', [], owner);
    aaveLibMock = await deployContractAndLinkLibraries('AaveV2Mock', [], { AaveV2: aaveLib.address }, owner);
    await systemFixture.controller.addModule(aaveLibMock.address);

    invokeLibMock = await deployContract('InvokeMock', [], owner);
    await systemFixture.controller.addModule(invokeLibMock.address);

    matrixToken = await systemFixture.createMatrixToken(
      [systemFixture.dai.address, systemFixture.weth.address],
      [ethToWei(1000), ethToWei(10)],
      [systemFixture.basicIssuanceModule.address, aaveLibMock.address, invokeLibMock.address],
      owner
    );

    await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
    await aaveLibMock.initializeModule(matrixToken.address);
    await invokeLibMock.initializeModule(matrixToken.address);

    await systemFixture.dai.approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);
    await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);
    await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('getDepositCalldata', function () {
    let asset;
    let onBehalfOf;
    let referralCode;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      referralCode = ZERO;
      onBehalfOf = owner.address;
      asset = systemFixture.weth.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getDepositCalldata() {
      return await aaveLibMock.testGetDepositCalldata(lendingPoolAddress, asset, amountNotional, onBehalfOf, referralCode);
    }

    it('should get correct data', async function () {
      const [target, value, calldata] = await getDepositCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('deposit', [asset, amountNotional, onBehalfOf, referralCode]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeDeposit', function () {
    let asset;
    let matrixTokenAddress;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);

      asset = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeDeposit() {
      return await aaveLibMock.testInvokeDeposit(matrixTokenAddress, lendingPoolAddress, asset, amountNotional);
    }

    it('should mint aWETH', async function () {
      const oldATokenBalance = await aWETH.balanceOf(matrixToken.address);
      await invokeDeposit();
      const newATokenBalance = await aWETH.balanceOf(matrixToken.address);
      expect(newATokenBalance.sub(oldATokenBalance)).eq(amountNotional);
    });
  });

  describe('getSetUserUseReserveAsCollateralCalldata', function () {
    let asset;
    let isUseAsCollateral;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      asset = systemFixture.weth.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getSetUserUseReserveAsCollateralCalldata() {
      return await aaveLibMock.testGetSetUserUseReserveAsCollateralCalldata(lendingPoolAddress, asset, isUseAsCollateral);
    }

    it('should get correct data when use as collateral is true', async function () {
      isUseAsCollateral = true;
      const [target, value, calldata] = await getSetUserUseReserveAsCollateralCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('setUserUseReserveAsCollateral', [asset, isUseAsCollateral]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });

    it('should get correct data when use as collateral is false', async function () {
      isUseAsCollateral = false;
      const [target, value, calldata] = await getSetUserUseReserveAsCollateralCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('setUserUseReserveAsCollateral', [asset, isUseAsCollateral]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeSetUserUseReserveAsCollateral', function () {
    let asset;
    let matrixTokenAddress;
    let isUseAsCollateral;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);
      await aaveLibMock.testInvokeDeposit(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, ethToWei(1));

      asset = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeSetUserUseReserveAsCollateral() {
      return await aaveLibMock.testInvokeSetUserUseReserveAsCollateral(matrixTokenAddress, lendingPoolAddress, asset, isUseAsCollateral);
    }

    it('should set use reserve as collateral by MatrixToken to true when use as collateral is true', async function () {
      isUseAsCollateral = true;
      await invokeSetUserUseReserveAsCollateral();
      const currentUseAsCollateral = (await aaveV2Fixture.protocolDataProvider.getUserReserveData(asset, matrixTokenAddress)).usageAsCollateralEnabled;
      expect(currentUseAsCollateral).eq(isUseAsCollateral);
    });

    it('should set use reserve as collateral by MatrixToken to false when use as collateral is false', async function () {
      isUseAsCollateral = false;
      await invokeSetUserUseReserveAsCollateral();
      const currentUseAsCollateral = (await aaveV2Fixture.protocolDataProvider.getUserReserveData(asset, matrixTokenAddress)).usageAsCollateralEnabled;
      expect(currentUseAsCollateral).eq(isUseAsCollateral);
    });
  });

  describe('getWithdrawCalldata', function () {
    let asset;
    let receiver;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      receiver = owner.address;
      asset = systemFixture.weth.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getWithdrawCalldata() {
      return await aaveLibMock.testGetWithdrawCalldata(lendingPoolAddress, asset, amountNotional, receiver);
    }

    it('should get correct data', async function () {
      const [target, value, calldata] = await getWithdrawCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('withdraw', [asset, amountNotional, receiver]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeWithdraw', function () {
    let asset;
    let matrixTokenAddress;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);
      await aaveLibMock.testInvokeDeposit(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, ethToWei(1));

      asset = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeWithdraw() {
      return await aaveLibMock.testInvokeWithdraw(matrixTokenAddress, lendingPoolAddress, asset, amountNotional);
    }

    it('should burn aWETH and return underlying WETH', async function () {
      const oldATokenBalance = await aWETH.balanceOf(matrixToken.address);
      const oldUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);
      await invokeWithdraw();
      const newATokenBalance = await aWETH.balanceOf(matrixToken.address);
      const newUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);

      // 1:1 ratio for aTokena & underlying
      expect(oldATokenBalance.sub(newATokenBalance)).eq(amountNotional);
      expect(newUnderlyingBalance.sub(oldUnderlyingBalance)).eq(amountNotional);
    });
  });

  describe('getBorrowCalldata', function () {
    let asset;
    let onBehalfOf;
    let referralCode;
    let interestRateMode;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      referralCode = ZERO;
      onBehalfOf = owner.address;
      asset = systemFixture.weth.address;
      interestRateMode = stableInterestRateMode;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getBorrowCalldata() {
      return await aaveLibMock.testGetBorrowCalldata(lendingPoolAddress, asset, amountNotional, interestRateMode, referralCode, onBehalfOf);
    }

    it('should get correct data', async function () {
      const [target, value, calldata] = await getBorrowCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('borrow', [
        asset,
        amountNotional,
        interestRateMode,
        referralCode,
        onBehalfOf,
      ]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeBorrow', function () {
    let asset;
    let interestRateMode;
    let matrixTokenAddress;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);
      await aaveLibMock.testInvokeDeposit(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, ethToWei(1));
      await aaveLibMock.testInvokeSetUserUseReserveAsCollateral(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, true);

      asset = systemFixture.dai.address;
      matrixTokenAddress = matrixToken.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeBorrow() {
      return await aaveLibMock.testInvokeBorrow(matrixTokenAddress, lendingPoolAddress, asset, amountNotional, interestRateMode);
    }

    it('should mint stableDebtDAI when selected intereset rate mode is stable', async function () {
      interestRateMode = stableInterestRateMode;
      const oldDebtTokenBalance = await stableDebtDAI.balanceOf(matrixToken.address);
      await invokeBorrow();
      const newDebtTokenBalance = await stableDebtDAI.balanceOf(matrixToken.address);
      expect(newDebtTokenBalance.sub(oldDebtTokenBalance)).eq(amountNotional);
    });

    it('should mint variableDebtDAI when selected intereset rate mode is variable', async function () {
      interestRateMode = variableInterestRateMode;
      const oldDebtTokenBalance = await variableDebtDAI.balanceOf(matrixToken.address);
      await invokeBorrow();
      const newDebtTokenBalance = await variableDebtDAI.balanceOf(matrixToken.address);
      expect(newDebtTokenBalance.sub(oldDebtTokenBalance)).eq(amountNotional);
    });
  });

  describe('getRepayCalldata', function () {
    let asset;
    let onBehalfOf;
    let interestRateMode;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      onBehalfOf = owner.address;
      asset = systemFixture.weth.address;
      interestRateMode = variableInterestRateMode;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getRepayCalldata() {
      return await aaveLibMock.testGetRepayCalldata(lendingPoolAddress, asset, amountNotional, interestRateMode, onBehalfOf);
    }

    it('should get correct data', async function () {
      const [target, value, calldata] = await getRepayCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('repay', [asset, amountNotional, interestRateMode, onBehalfOf]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeRepay', function () {
    let asset;
    let interestRateMode;
    let matrixTokenAddress;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);
      await aaveLibMock.testInvokeDeposit(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, ethToWei(1));
      await aaveLibMock.testInvokeSetUserUseReserveAsCollateral(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, true);
      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.dai.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256); // for repaying

      asset = systemFixture.dai.address;
      matrixTokenAddress = matrixToken.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeRepay() {
      return await aaveLibMock.testInvokeRepay(matrixTokenAddress, lendingPoolAddress, asset, amountNotional, interestRateMode);
    }

    it('should repay DAI and burn stableDebtDAI when selected intereset rate mode is stable', async function () {
      interestRateMode = stableInterestRateMode;
      await aaveLibMock.testInvokeBorrow(matrixTokenAddress, lendingPoolAddress, asset, amountNotional, stableInterestRateMode);

      const oldUnderlyingBalance = await systemFixture.dai.balanceOf(matrixToken.address);
      await invokeRepay();
      const newUnderlyingBalance = await systemFixture.dai.balanceOf(matrixToken.address);
      expect(oldUnderlyingBalance.sub(newUnderlyingBalance)).eq(amountNotional);
    });

    it('should repay DAI and burn variableDebtDAI when selected intereset rate mode is variable', async function () {
      interestRateMode = variableInterestRateMode;
      await aaveLibMock.testInvokeBorrow(matrixTokenAddress, lendingPoolAddress, asset, amountNotional, variableInterestRateMode);

      const oldUnderlyingBalance = await systemFixture.dai.balanceOf(matrixToken.address);
      await invokeRepay();
      const newUnderlyingBalance = await systemFixture.dai.balanceOf(matrixToken.address);
      expect(oldUnderlyingBalance.sub(newUnderlyingBalance)).eq(amountNotional);
    });
  });

  describe('getSwapBorrowRateModeCalldata', function () {
    let asset;
    let rateMode;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      asset = systemFixture.weth.address;
      rateMode = stableInterestRateMode;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function getSwapBorrowRateModeCalldata() {
      return await aaveLibMock.testGetSwapBorrowRateModeCalldata(lendingPoolAddress, asset, rateMode);
    }

    it('should get correct data', async function () {
      const [target, value, calldata] = await getSwapBorrowRateModeCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('swapBorrowRateMode', [asset, rateMode]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });

    it('should get correct data when borrow rate mode is variable', async function () {
      rateMode = variableInterestRateMode;

      const [target, value, calldata] = await getSwapBorrowRateModeCalldata();
      const expectedCalldata = aaveV2Fixture.lendingPool.interface.encodeFunctionData('swapBorrowRateMode', [asset, rateMode]);

      expect(target).eq(lendingPoolAddress);
      expect(value).eq(ZERO);
      expect(calldata).eq(expectedCalldata);
    });
  });

  describe('invokeSwapBorrowRateMode', function () {
    let asset;
    let rateMode;
    let matrixTokenAddress;
    let lendingPoolAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      await invokeLibMock.testInvokeApprove(matrixToken.address, systemFixture.weth.address, aaveV2Fixture.lendingPool.address, MAX_UINT_256);
      await aaveLibMock.testInvokeDeposit(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, ethToWei(1));
      await aaveLibMock.testInvokeSetUserUseReserveAsCollateral(matrixToken.address, aaveV2Fixture.lendingPool.address, systemFixture.weth.address, true);

      matrixTokenAddress = matrixToken.address;
      asset = systemFixture.dai.address;
      lendingPoolAddress = aaveV2Fixture.lendingPool.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function invokeSwapBorrowRateMode() {
      return await aaveLibMock.testInvokeSwapBorrowRateMode(matrixTokenAddress, lendingPoolAddress, asset, rateMode);
    }

    it('should burn stableDebtDAI and mint equivalent amount of variableDebtDAI when moving to stable mode from variable mode', async function () {
      expect(await stableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);

      // Borrow DAI in variable rate mode
      await aaveLibMock.testInvokeBorrow(
        matrixToken.address,
        aaveV2Fixture.lendingPool.address,
        systemFixture.dai.address,
        ethToWei(100),
        variableInterestRateMode
      );

      expect(await stableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).eq(ethToWei(100));

      rateMode = variableInterestRateMode;
      await invokeSwapBorrowRateMode();

      expect(await stableDebtDAI.balanceOf(matrixToken.address)).gt(ethToWei(100));
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);
    });

    it('should burn variableDebtDAI and mint equivalent amount of stableDebtDAI when moving to variable mode from stable mode', async function () {
      expect(await stableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);

      // Borrow DAI in stable rate mode
      await aaveLibMock.testInvokeBorrow(
        matrixToken.address,
        aaveV2Fixture.lendingPool.address,
        systemFixture.dai.address,
        ethToWei(100),
        stableInterestRateMode
      );

      expect(await stableDebtDAI.balanceOf(matrixToken.address)).eq(ethToWei(100));
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);

      rateMode = stableInterestRateMode;
      await invokeSwapBorrowRateMode();

      expect(await stableDebtDAI.balanceOf(matrixToken.address)).eq(ZERO);
      expect(await variableDebtDAI.balanceOf(matrixToken.address)).gt(ethToWei(100));
    });
  });
});
