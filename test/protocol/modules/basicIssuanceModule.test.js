// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../helpers/deploy');
const { ethToWei, btcToWei } = require('../../helpers/unitUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { preciseMul, preciseMulCeilUint } = require('../../helpers/mathUtil');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { ZERO_ADDRESS, ZERO, ONE, MODULE_STATE } = require('../../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract BasicIssuanceModule', async () => {
  const [owner, feeRecipient, recipient, randomAccount] = await getSigners();
  const systemFixture = new SystemFixture(owner, feeRecipient);

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

  describe('initialize', async () => {
    let preIssueHookAddress;

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();
      const components = [systemFixture.weth.address];
      const units = [ethToWei(1)];
      const modules = [systemFixture.basicIssuanceModule.address];
      matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);
      preIssueHookAddress = await getRandomAddress();
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
    });

    async function initialize() {
      return systemFixture.basicIssuanceModule.connect(caller).initialize(matrixTokenAddress, preIssueHookAddress);
    }

    it('should basicIssuanceModule be enabled in the MatrixToken', async () => {
      await initialize();
      const result = await matrixToken.isInitializedModule(systemFixture.basicIssuanceModule.address);
      expect(result).is.true;
    });

    it('should properly set the issuance hooks', async () => {
      const result = await systemFixture.basicIssuanceModule.getManagerIssuanceHook(matrixTokenAddress);
      expect(result).eq(preIssueHookAddress);
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = await randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when MatrixToken is not in pending state', async () => {
      const newModule = await getRandomAddress();
      await systemFixture.controller.addModule(newModule);
      const newToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [newModule], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const newToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.basicIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });
  });

  describe('removeModule', async () => {
    it('should revert when remove BasicIssuanceModule', async () => {
      await expect(systemFixture.basicIssuanceModule.connect(owner).removeModule()).revertedWith('BI0');
    });
  });

  describe('issue', async () => {
    const units = [ethToWei(1), btcToWei(2)];

    let components;
    let issueQuantity;
    let preIssueHookAddress;

    async function issue() {
      return systemFixture.basicIssuanceModule.connect(caller).issue(matrixTokenAddress, issueQuantity, recipient.address);
    }

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();

      const modules = [systemFixture.basicIssuanceModule.address];
      components = [systemFixture.weth.address, systemFixture.wbtc.address];
      matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);

      // Approve tokens to the issuance mdoule
      await systemFixture.weth.connect(owner).approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
      await systemFixture.wbtc.connect(owner).approve(systemFixture.basicIssuanceModule.address, btcToWei(200));
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      caller = owner;
      issueQuantity = ethToWei(2);
      matrixTokenAddress = matrixToken.address;
    });

    context('when the components are WBTC and WETH and no hooks', async () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        preIssueHookAddress = ZERO_ADDRESS;
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, preIssueHookAddress);
      });

      after(async () => {
        revertBlockchain(snapshotId);
      });

      it('should revert when the issue issueQuantity is 0', async () => {
        issueQuantity = ZERO;
        await expect(issue()).revertedWith('BI1');
      });

      it('should revert when the MatrixToken is not enabled on the controller', async () => {
        const nonEnabledToken = await systemFixture.createRawMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address],
          owner.address
        );
        matrixTokenAddress = nonEnabledToken.address;
        await expect(issue()).revertedWith('M3');
      });

      it('should issue the Set to the recipient', async () => {
        const oldBalance = await matrixToken.balanceOf(recipient.address);
        await issue();
        const newBalance = await matrixToken.balanceOf(recipient.address);
        expect(newBalance).eq(oldBalance.add(issueQuantity));
      });

      it('should deposited correct quantity WETH into the MatrixToken', async () => {
        const oldBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        await issue();
        const newBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        expect(newBalance.sub(oldBalance)).eq(preciseMulCeilUint(issueQuantity, units[0]));
      });

      it('should deposited correct quantity WBTC into the MatrixToken', async () => {
        const oldBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        await issue();
        const newBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        expect(newBalance.sub(oldBalance)).eq(preciseMulCeilUint(issueQuantity, units[1]));
      });

      it('should emit the IssueMatrixToken event', async () => {
        const componentQuantities = [preciseMul(units[0], issueQuantity), preciseMul(units[1], issueQuantity)];

        await expect(issue())
          .emit(systemFixture.basicIssuanceModule, 'IssueMatrixToken')
          .withArgs(matrixTokenAddress, caller.address, recipient.address, ZERO_ADDRESS, issueQuantity, components, componentQuantities);
      });

      it('should deposited correct quantity WETH into the MatrixToken when issue extremely small', async () => {
        const oldBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        issueQuantity = ONE;
        await issue();
        const newBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        expect(newBalance.sub(oldBalance)).eq(preciseMulCeilUint(issueQuantity, units[0]));
      });

      it('should deposited correct quantity WBTC into the MatrixToken when issue extremely small', async () => {
        const oldBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        issueQuantity = ONE;
        await issue();
        const newBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        expect(newBalance.sub(oldBalance)).eq(preciseMulCeilUint(issueQuantity, units[1]));
      });

      it('should add self as module and update the position state', async () => {
        await systemFixture.controller.addModule(owner.address);
        await matrixToken.addModule(owner.address);
        await matrixToken.initializeModule();
        const result = await matrixToken.getModuleState(owner.address);
        expect(result).eq(MODULE_STATE['INITIALIZED']);
      });

      it('should revert when one of the components has a recipient-related fee', async () => {
        const tokenWithFee = await deployContract('Erc20WithFeeMock', ['Erc20WithFeeMock', 'TEST', 5], owner);
        await tokenWithFee.mint(owner.address, ethToWei(200));
        await tokenWithFee.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));

        const position = (await matrixToken.getPositions())[0];
        await matrixToken.addComponent(tokenWithFee.address);
        await matrixToken.editDefaultPositionUnit(tokenWithFee.address, position.unit);

        await expect(issue()).revertedWith('ES1');
      });

      it('should revert when a MatrixToken position is not in default state', async () => {
        const position = (await matrixToken.getPositions())[0];
        await matrixToken.addExternalPositionModule(position.component, position.module);
        await matrixToken.editExternalPositionUnit(position.component, position.module, position.unit);
        await expect(issue()).revertedWith('BI3');
      });
    });

    context('when a preIssueHook has been set', async () => {
      let preIssueHookContract;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        preIssueHookContract = await deployContract('ManagerIssuanceHookMock', [], owner);
        preIssueHookAddress = preIssueHookContract.address;
        await systemFixture.basicIssuanceModule.connect(owner).initialize(matrixToken.address, preIssueHookAddress);
      });

      after(async () => {
        revertBlockchain(snapshotId);
      });

      it('should properly call the pre-issue hooks', async () => {
        await issue();
        expect(await preIssueHookContract.getToken()).eq(matrixTokenAddress);
        expect(await preIssueHookContract.getQuantity()).eq(issueQuantity);
        expect(await preIssueHookContract.getSender()).eq(owner.address);
        expect(await preIssueHookContract.getTo()).eq(recipient.address);
      });

      it('should emit the IssueMatrixToken event', async () => {
        const componentQuantities = [preciseMul(units[0], issueQuantity), preciseMul(units[1], issueQuantity)];

        await expect(issue())
          .emit(systemFixture.basicIssuanceModule, 'IssueMatrixToken')
          .withArgs(matrixTokenAddress, caller.address, recipient.address, preIssueHookContract.address, issueQuantity, components, componentQuantities);
      });
    });
  });

  describe('redeem', async () => {
    const units = [ethToWei(1), btcToWei(2)];

    let components;
    let redeemQuantity;

    async function redeem() {
      return systemFixture.basicIssuanceModule.connect(caller).redeem(matrixTokenAddress, redeemQuantity, recipient.address);
    }

    let snapshotId;
    before(async () => {
      snapshotId = await snapshotBlockchain();

      const modules = [systemFixture.basicIssuanceModule.address];
      components = [systemFixture.weth.address, systemFixture.wbtc.address];
      matrixToken = await systemFixture.createMatrixToken(components, units, modules, owner.address);

      // Approve tokens to the issuance module
      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(100));
      await systemFixture.wbtc.approve(systemFixture.basicIssuanceModule.address, btcToWei(200));

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
    });

    after(async () => {
      revertBlockchain(snapshotId);
    });

    beforeEach(async () => {
      const issueQuantity = ethToWei(2);

      caller = owner;
      redeemQuantity = ethToWei(1);
      // preIssueHookAddress = ZERO_ADDRESS;
      matrixTokenAddress = matrixToken.address;

      await systemFixture.basicIssuanceModule.issue(matrixTokenAddress, issueQuantity, caller.address);
    });

    it('should redeem MatrixToken', async () => {
      const oldBalance = await matrixToken.balanceOf(owner.address);
      await redeem();
      const newBalance = await matrixToken.balanceOf(owner.address);
      expect(oldBalance.sub(newBalance)).eq(redeemQuantity);
    });

    it('should deposited correct quantity WETH to the recipient account', async () => {
      const oldBalance = await systemFixture.weth.balanceOf(recipient.address);
      await redeem();
      const newBalance = await systemFixture.weth.balanceOf(recipient.address);
      expect(newBalance.sub(oldBalance)).eq(preciseMul(redeemQuantity, units[0]));
    });

    it('should deposited correct quantity WBTC to the recipient account', async () => {
      const oldBalance = await systemFixture.wbtc.balanceOf(recipient.address);
      await redeem();
      const newBalance = await systemFixture.wbtc.balanceOf(recipient.address);
      expect(newBalance.sub(oldBalance)).eq(preciseMul(redeemQuantity, units[1]));
    });

    it('should have subtracted WETH from the MatrixToken', async () => {
      const oldBalance = await systemFixture.weth.balanceOf(matrixToken.address);
      await redeem();
      const newBalance = await systemFixture.weth.balanceOf(matrixToken.address);
      expect(oldBalance.sub(newBalance)).eq(preciseMul(redeemQuantity, units[0]));
    });

    it('should have subtracted WBTC from the MatrixToken', async () => {
      const oldBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
      await redeem();
      const newBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
      expect(oldBalance.sub(newBalance)).eq(preciseMul(redeemQuantity, units[1]));
    });

    it('should emit the RedeemMatrixToken event', async () => {
      await expect(redeem())
        .emit(systemFixture.basicIssuanceModule, 'RedeemMatrixToken')
        .withArgs(matrixTokenAddress, caller.address, recipient.address, ZERO_ADDRESS, redeemQuantity, components, units);
    });

    it('should deposited correct quantity WETH to recipient account when redeem extremely small', async () => {
      const oldBalance = await systemFixture.weth.balanceOf(recipient.address);
      redeemQuantity = ONE;
      await redeem();
      const newBalance = await systemFixture.weth.balanceOf(recipient.address);
      expect(newBalance.sub(oldBalance)).eq(preciseMul(redeemQuantity, units[0]));
    });

    it('should deposited correct quantity WBTC to recipient account when redeem extremely small', async () => {
      const oldBalance = await systemFixture.wbtc.balanceOf(recipient.address);
      redeemQuantity = ONE;
      await redeem();
      const newBalance = await systemFixture.wbtc.balanceOf(recipient.address);
      expect(newBalance.sub(oldBalance)).eq(preciseMul(redeemQuantity, units[1]));
    });

    it('should revert when the issue quantity is greater than the callers balance', async () => {
      redeemQuantity = ethToWei(10000);
      await expect(redeem()).revertedWith('ERC20: burn amount exceeds balance');
    });

    it('should revert when the issue quantity is 0', async () => {
      redeemQuantity = ZERO;
      await expect(redeem()).revertedWith('BI2a');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const nonEnabledToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.basicIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = nonEnabledToken.address;
      await expect(redeem()).revertedWith('M3');
    });

    it('should add self as module and update the position state', async () => {
      await systemFixture.controller.addModule(owner.address);
      await matrixToken.addModule(owner.address);
      await matrixToken.initializeModule();
      const result = await matrixToken.getModuleState(owner.address);
      expect(result).eq(MODULE_STATE['INITIALIZED']);
    });

    it('should revert when a MatrixToken position is not in default state', async () => {
      const position = (await matrixToken.getPositions())[0];
      await matrixToken.addExternalPositionModule(position.component, position.module);
      await matrixToken.editExternalPositionUnit(position.component, position.module, position.unit);
      await expect(redeem()).revertedWith('BI2b');
      await matrixToken.removeExternalPositionModule(position.component, position.module);
    });

    // it('should revert when one of the components has a recipient-related fee', async () => {
    //   const tokenWithFee = await deployContract('Erc20WithFeeMock', ['Erc20WithFeeMock', 'TEST', 5], owner);
    //   await tokenWithFee.mint(matrixToken.address, ethToWei(200));

    //   const position = (await matrixToken.getPositions())[0];
    //   await matrixToken.addComponent(tokenWithFee.address);
    //   await matrixToken.editDefaultPositionUnit(tokenWithFee.address, position.unit);
    //   await expect(redeem()).revertedWith('ES0');
    // });
  });
});
