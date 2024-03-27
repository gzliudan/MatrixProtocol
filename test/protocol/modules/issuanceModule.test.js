// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { preciseMul } = require('../../helpers/mathUtil');
const { deployContract } = require('../../helpers/deploy');
const { ethToWei, btcToWei } = require('../../helpers/unitUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ZERO, ONE, ZERO_ADDRESS } = require('../../helpers/constants');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract IssuanceModule', () => {
  const [owner, protocolFeeRecipient, recipient, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);

  let caller;
  let matrixToken;
  let matrixTokenAddress;
  let to;
  let preIssueHook;
  let issuanceModule; // IssuanceModule
  let moduleIssuanceHook; // ModuleIssuanceHookMock

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    issuanceModule = await deployContract('IssuanceModule', [systemFixture.controller.address, 'IssuanceModule'], owner);
    moduleIssuanceHook = await deployContract('ModuleIssuanceHookMock', [], owner);
    await systemFixture.controller.addModule(issuanceModule.address);
    await systemFixture.controller.addModule(moduleIssuanceHook.address);
    await systemFixture.controller.addModule(owner.address);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('initialize', () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [issuanceModule.address], owner.address);
      matrixTokenAddress = matrixToken.address;
      preIssueHook = await getRandomAddress();
      caller = owner;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return issuanceModule.connect(caller).initialize(matrixTokenAddress, preIssueHook);
    }

    it('should enable the Module on the MatrixToken', async () => {
      await initialize();
      const isModuleEnabled = await matrixToken.isInitializedModule(issuanceModule.address);
      expect(isModuleEnabled).is.true;
    });

    it('should properly set the issuance hooks', async () => {
      await initialize();
      const preIssuanceHooks = await issuanceModule.getManagerIssuanceHook(matrixTokenAddress);
      expect(preIssuanceHooks).eq(preIssueHook);
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
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
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [issuanceModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });
  });

  describe('removeModule', () => {
    it('should revert when removeModule', async () => {
      caller = owner;
      await expect(issuanceModule.connect(caller).removeModule()).revertedWith('IM2');
    });
  });

  describe('issue', () => {
    let issueQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    context('when the components are default WBTC, WETH, and external DAI', async () => {
      beforeEach(async () => {
        const components = [systemFixture.weth.address, systemFixture.wbtc.address];
        const uints = [ethToWei(1), btcToWei(2)];
        const modules = [issuanceModule.address, moduleIssuanceHook.address, owner.address];
        matrixToken = await systemFixture.createMatrixToken(components, uints, modules, owner.address);
        matrixTokenAddress = matrixToken.address;

        await issuanceModule.initialize(matrixToken.address, preIssueHook);
        await moduleIssuanceHook.initialize(matrixToken.address);
        await matrixToken.initializeModule();

        // Add a DAI position held by an external mock
        await matrixToken.addComponent(systemFixture.dai.address);
        await matrixToken.addExternalPositionModule(systemFixture.dai.address, moduleIssuanceHook.address);
        await matrixToken.editExternalPositionUnit(systemFixture.dai.address, moduleIssuanceHook.address, ethToWei(3));

        // Approve tokens to the module
        await systemFixture.weth.approve(issuanceModule.address, ethToWei(5));
        await systemFixture.wbtc.approve(issuanceModule.address, btcToWei(10));
        await systemFixture.dai.approve(issuanceModule.address, ethToWei(6));

        issueQuantity = ethToWei(2);
        to = recipient;
        caller = owner;
      });

      context('when there are no hooks', async () => {
        before(async () => {
          preIssueHook = ZERO_ADDRESS;
        });

        async function issue() {
          return issuanceModule.connect(caller).issue(matrixTokenAddress, issueQuantity, to.address);
        }

        it('should issue the Matrixoken to the recipient', async () => {
          const oldBalance = await matrixToken.balanceOf(recipient.address);
          await issue();
          const newBalance = await matrixToken.balanceOf(recipient.address);
          expect(newBalance.sub(oldBalance)).eq(issueQuantity);
        });

        it('should have deposited the eth and wbtc into the MatrixToken', async () => {
          const oldBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          const oldWEthBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          await issue();
          const newBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          const newWEthBalance = await systemFixture.weth.balanceOf(matrixToken.address);

          expect(newWEthBalance.sub(oldWEthBalance)).eq(issueQuantity);
          expect(newBtcBalance.sub(oldBtcBalance)).eq(preciseMul(issueQuantity, btcToWei(2)));
        });

        it('should have deposited DAI into the module hook contract', async () => {
          const oldDaiBalance = await systemFixture.dai.balanceOf(moduleIssuanceHook.address);
          await issue();
          const newDaiBalance = await systemFixture.dai.balanceOf(moduleIssuanceHook.address);
          expect(newDaiBalance.sub(oldDaiBalance)).eq(preciseMul(ethToWei(3), issueQuantity));
        });

        it('should emit the IssueMatrixToken event', async () => {
          await expect(issue()).emit(issuanceModule, 'IssueMatrixToken').withArgs(matrixTokenAddress, caller.address, to.address, ZERO_ADDRESS, issueQuantity);
        });

        it('should transfer the minimal units of components to the MatrixToken when the issue quantity is extremely small', async () => {
          issueQuantity = ONE;
          const oldBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          const oldWethBalance = await systemFixture.weth.balanceOf(matrixToken.address);
          await issue();
          const newBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          const newWethBalance = await systemFixture.weth.balanceOf(matrixToken.address);

          expect(newBtcBalance.sub(oldBtcBalance)).eq(ONE);
          expect(newWethBalance.sub(oldWethBalance)).eq(ONE);
        });

        it('should revert when an external position is a negative value', async () => {
          await matrixToken.editExternalPositionUnit(systemFixture.dai.address, moduleIssuanceHook.address, ethToWei(-1));
          await expect(issue()).revertedWith('M3');
        });

        it('should revert when the issue quantity is 0', async () => {
          issueQuantity = ZERO;
          await expect(issue()).revertedWith('IM0');
        });

        it('should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [issuanceModule.address], owner.address);
          matrixTokenAddress = newToken.address;
          await expect(issue()).revertedWith('M3');
        });
      });

      context('when a preIssueHook has been set', async () => {
        let managerIssuanceHookMock;

        before(async () => {
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          preIssueHook = managerIssuanceHookMock.address;
        });

        async function issue() {
          return issuanceModule.issue(matrixTokenAddress, issueQuantity, to.address);
        }

        it('should properly call the pre-issue hooks when a preIssueHook has been set', async () => {
          await issue();
          expect(await managerIssuanceHookMock.getToken()).eq(matrixTokenAddress);
          expect(await managerIssuanceHookMock.getQuantity()).eq(issueQuantity);
          expect(await managerIssuanceHookMock.getSender()).eq(owner.address);
          expect(await managerIssuanceHookMock.getTo()).eq(to.address);
        });
      });
    });
  });

  describe('redeem', () => {
    let to;
    let redeemQuantity;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    context('when the components are WBTC and WETH', async () => {
      beforeEach(async () => {
        preIssueHook = ZERO_ADDRESS;

        const modules = [issuanceModule.address, moduleIssuanceHook.address, owner.address];
        matrixToken = await systemFixture.createMatrixToken(
          [systemFixture.weth.address, systemFixture.wbtc.address],
          [ethToWei(1), btcToWei(2)],
          modules,
          owner.address
        );
        await issuanceModule.initialize(matrixToken.address, preIssueHook);
        await moduleIssuanceHook.initialize(matrixToken.address);
        await matrixToken.initializeModule();

        await matrixToken.addComponent(systemFixture.dai.address);
        await matrixToken.addExternalPositionModule(systemFixture.dai.address, moduleIssuanceHook.address);
        await matrixToken.editExternalPositionUnit(systemFixture.dai.address, moduleIssuanceHook.address, ethToWei(3));

        // Approve tokens to the controller
        await systemFixture.weth.approve(issuanceModule.address, ethToWei(5));
        await systemFixture.wbtc.approve(issuanceModule.address, btcToWei(10));
        await systemFixture.dai.approve(issuanceModule.address, ethToWei(15));

        matrixTokenAddress = matrixToken.address;
        redeemQuantity = ethToWei(1);
        to = recipient.address;
        caller = owner;

        const issueQuantity = ethToWei(2);
        await issuanceModule.issue(matrixTokenAddress, issueQuantity, caller.address);
      });

      async function redeem() {
        return issuanceModule.connect(caller).redeem(matrixTokenAddress, redeemQuantity, to);
      }

      it('should redeem the Matrixoken', async () => {
        const oldBalance = await matrixToken.balanceOf(owner.address);
        await redeem();
        const newBalance = await matrixToken.balanceOf(owner.address);
        expect(oldBalance.sub(newBalance)).eq(redeemQuantity);
      });

      it('should have deposited the components to the recipients account', async () => {
        const oldDaiBalance = await systemFixture.dai.balanceOf(recipient.address);
        const oldBtcBalance = await systemFixture.wbtc.balanceOf(recipient.address);
        const oldWethBalance = await systemFixture.weth.balanceOf(recipient.address);
        await redeem();
        const newDaiBalance = await systemFixture.dai.balanceOf(recipient.address);
        const newBtcBalance = await systemFixture.wbtc.balanceOf(recipient.address);
        const newWethBalance = await systemFixture.weth.balanceOf(recipient.address);

        expect(newWethBalance.sub(oldWethBalance)).eq(redeemQuantity);
        expect(newBtcBalance.sub(oldBtcBalance)).eq(preciseMul(redeemQuantity, btcToWei(2)));
        expect(newDaiBalance.sub(oldDaiBalance)).eq(preciseMul(redeemQuantity, ethToWei(3)));
      });

      it('should have subtracted from the components from the MatrixToken', async () => {
        const oldBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        const oldWethBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        await redeem();
        const newBtcBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
        const newWethBalance = await systemFixture.weth.balanceOf(matrixToken.address);

        expect(oldWethBalance.sub(newWethBalance)).eq(redeemQuantity);
        expect(oldBtcBalance.sub(newBtcBalance)).eq(redeemQuantity.mul(btcToWei(2)).div(ethToWei(1)));
      });

      it('should have subtracted from the components from the Module', async () => {
        const oldDaiBalance = await systemFixture.dai.balanceOf(moduleIssuanceHook.address);
        await redeem();
        const newDaiBalance = await systemFixture.dai.balanceOf(moduleIssuanceHook.address);
        expect(oldDaiBalance.sub(newDaiBalance)).eq(preciseMul(redeemQuantity, ethToWei(3)));
      });

      it('should emit the RedeemMatrixToken event', async () => {
        await expect(redeem()).emit(issuanceModule, 'RedeemMatrixToken').withArgs(matrixTokenAddress, caller.address, to, redeemQuantity);
      });

      it('should transfer the minimal units of components to the MatrixToken when the issue quantity is extremely small', async () => {
        redeemQuantity = ONE;
        const oldBtcBalanceOfCaller = await systemFixture.wbtc.balanceOf(caller.address);
        await redeem();
        const newBtcBalanceOfCaller = await systemFixture.wbtc.balanceOf(caller.address);
        expect(oldBtcBalanceOfCaller).eq(newBtcBalanceOfCaller);
      });

      it('should revert when an external position is a negative value', async () => {
        await matrixToken.editExternalPositionUnit(systemFixture.dai.address, moduleIssuanceHook.address, ethToWei(-1));
        await expect(redeem()).revertedWith('IM3');
      });

      it('should revert when the issue quantity is greater than the callers balance', async () => {
        redeemQuantity = ethToWei(4);
        await expect(redeem()).revertedWith('ERC20: burn amount exceeds balance');
      });

      it('should revert when one of the components has a recipient-related fee', async () => {
        const tokenWithFee = await deployContract('Erc20WithFeeMock', ['Erc20WithFeeMock', 'TEST', 5], owner);
        await tokenWithFee.mint(matrixToken.address, ethToWei(20));
        const retrievedPosition = (await matrixToken.getPositions())[0];
        await matrixToken.addComponent(tokenWithFee.address);
        await matrixToken.editDefaultPositionUnit(tokenWithFee.address, retrievedPosition.unit);
        await expect(redeem()).revertedWith('ES0');
      });

      it('should revert when the issue quantity is 0', async () => {
        redeemQuantity = ZERO;
        await expect(redeem()).revertedWith('IM1');
      });

      it('should revert when the MatrixToken is not enabled on the controller', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [issuanceModule.address], owner.address);
        matrixTokenAddress = newToken.address;
        await expect(redeem()).revertedWith('M3');
      });
    });
  });
});
