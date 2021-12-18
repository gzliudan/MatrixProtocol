// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../helpers/deploy');
const { ethToWei, btcToWei } = require('../../helpers/unitUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ZERO, ZERO_ADDRESS } = require('../../helpers/constants');
const { preciseMul, preciseMulCeilUint } = require('../../helpers/mathUtil');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract DebtIssuanceModule', async () => {
  const [owner, manager, protocolFeeRecipient, feeRecipient, recipient, dummyModule, randomAccount] = await getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let matrixToken;
  let matrixTokenAddress;
  let debtModuleMock; // DebtModuleMock
  let debtIssuanceModule; // DebtIssuanceModule
  let externalPositionModule; // ModuleIssuanceHookMock
  let managerIssuanceHookMock; // ManagerIssuanceHookMock

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    debtIssuanceModule = await deployContract('DebtIssuanceModule', [systemFixture.controller.address], owner);
    debtModuleMock = await deployContract('DebtModuleMock', [systemFixture.controller.address, debtIssuanceModule.address], owner);
    externalPositionModule = await deployContract('ModuleIssuanceHookMock', [], owner);
    managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);

    await systemFixture.controller.addModule(debtIssuanceModule.address);
    await systemFixture.controller.addModule(debtModuleMock.address);
    await systemFixture.controller.addModule(externalPositionModule.address);

    const modules = [systemFixture.basicIssuanceModule.address, debtIssuanceModule.address, debtModuleMock.address, externalPositionModule.address];
    matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], modules, manager.address, 'DebtToken', 'DBT');

    await externalPositionModule.initialize(matrixToken.address);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('initialize', async () => {
    let maxManagerFee;
    let managerIssueFee;
    let managerRedeemFee;
    let feeRecipientAddress;
    let managerIssuanceHook;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixTokenAddress = matrixToken.address;
      maxManagerFee = ethToWei(0.02);
      managerIssueFee = ethToWei(0.005);
      managerRedeemFee = ethToWei(0.004);
      feeRecipientAddress = feeRecipient.address;
      managerIssuanceHook = owner.address;
      caller = manager;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return debtIssuanceModule
        .connect(caller)
        .initialize(matrixTokenAddress, maxManagerFee, managerIssueFee, managerRedeemFee, feeRecipientAddress, managerIssuanceHook);
    }

    it('should set the correct state', async () => {
      await initialize();
      const setting = await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress);
      expect(setting.maxManagerFee).eq(maxManagerFee);
      expect(setting.managerIssueFee).eq(managerIssueFee);
      expect(setting.managerRedeemFee).eq(managerRedeemFee);
      expect(setting.feeRecipient).eq(feeRecipientAddress);
      expect(setting.managerIssuanceHook).eq(managerIssuanceHook);
    });

    it('should revert when the issue fee is greater than the maximum fee', async () => {
      managerIssueFee = ethToWei(0.03);
      await expect(initialize()).revertedWith('D0a');
    });

    it('should revert when the redeem fee is greater than the maximum fee', async () => {
      managerRedeemFee = ethToWei(0.03);
      await expect(initialize()).revertedWith('D0b');
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when MatrixToken is not in pending state', async () => {
      const newModule = await getRandomAddress();
      await systemFixture.controller.addModule(newModule);
      const newToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [newModule], manager.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], manager.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });
  });

  context('DebtIssuanceModule has been initialized', async () => {
    let isInitialized = false;

    let preIssueHook;
    let maxFee;
    let issueFee;
    let redeemFee;

    before(async () => {
      preIssueHook = ZERO_ADDRESS;
      maxFee = ethToWei(0.02);
      issueFee = ethToWei(0.005);
      redeemFee = ethToWei(0.005);
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
      if (!isInitialized) {
        await debtIssuanceModule.connect(manager).initialize(matrixToken.address, maxFee, issueFee, redeemFee, feeRecipient.address, preIssueHook);
      }
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    describe('removeModule', async () => {
      let testModule;

      beforeEach(async () => {
        testModule = debtIssuanceModule.address;
      });

      async function removeModule() {
        return matrixToken.connect(manager).removeModule(testModule);
      }

      it('should set the correct state', async () => {
        await removeModule();
        const setting = await debtIssuanceModule.getIssuanceSetting(matrixToken.address);
        expect(setting.managerIssueFee).eq(ZERO);
        expect(setting.managerRedeemFee).eq(ZERO);
        expect(setting.feeRecipient).eq(ZERO_ADDRESS);
        expect(setting.managerIssuanceHook).eq(ZERO_ADDRESS);
      });

      it('should revert when a module is still registered with the DebtIssuanceModule', async () => {
        await systemFixture.controller.addModule(dummyModule.address);
        await matrixToken.connect(manager).addModule(dummyModule.address);
        await matrixToken.connect(dummyModule).initializeModule();
        await debtIssuanceModule.connect(dummyModule).registerToIssuanceModule(matrixToken.address);
        await expect(removeModule()).revertedWith('D1');
      });
    });

    describe('registerToIssuanceModule', async () => {
      beforeEach(async () => {
        caller = dummyModule;
        matrixTokenAddress = matrixToken.address;
        await systemFixture.controller.addModule(dummyModule.address);
        await matrixToken.connect(manager).addModule(dummyModule.address);
        await matrixToken.connect(dummyModule).initializeModule();
      });

      async function registerToIssuanceModule() {
        return debtIssuanceModule.connect(caller).registerToIssuanceModule(matrixTokenAddress);
      }

      it('should add dummyModule to moduleIssuanceHooks', async () => {
        await registerToIssuanceModule();
        const moduleHooks = await debtIssuanceModule.getModuleIssuanceHooks(matrixTokenAddress);
        expect(moduleHooks).contain(caller.address);
      });

      it('should mark dummyModule as a valid module issuance hook', async () => {
        await registerToIssuanceModule();
        const isModuleHook = await debtIssuanceModule.isModuleIssuanceHook(matrixTokenAddress, dummyModule.address);
        expect(isModuleHook).is.true;
      });

      describe('when DebtIssuanceModule is not initialized', async () => {
        before(async () => {
          isInitialized = true;
        });

        after(async () => {
          isInitialized = false;
        });

        it('should revert', async () => {
          await expect(registerToIssuanceModule()).revertedWith('M3');
        });
      });

      it('should revert when module is already registered', async () => {
        await registerToIssuanceModule();
        await expect(registerToIssuanceModule()).revertedWith('D7');
      });
    });

    describe('unregisterFromIssuanceModule', async () => {
      let isRegistered = false;

      beforeEach(async () => {
        caller = dummyModule;
        matrixTokenAddress = matrixToken.address;
        await systemFixture.controller.addModule(dummyModule.address);
        await matrixToken.connect(manager).addModule(dummyModule.address);
        await matrixToken.connect(dummyModule).initializeModule();
        if (!isRegistered) {
          await debtIssuanceModule.connect(dummyModule).registerToIssuanceModule(matrixToken.address);
        }
      });

      async function unregisterFromIssuanceModule() {
        return debtIssuanceModule.connect(caller).unregisterFromIssuanceModule(matrixTokenAddress);
      }

      it('should remove dummyModule from issuanceSettings', async () => {
        const preModuleHooks = await debtIssuanceModule.getModuleIssuanceHooks(matrixTokenAddress);
        expect(preModuleHooks).contain(caller.address);
        await unregisterFromIssuanceModule();
        const postModuleHooks = await debtIssuanceModule.getModuleIssuanceHooks(matrixTokenAddress);
        expect(postModuleHooks).not.contain(caller.address);
      });

      it('should not mark dummyModule as a valid module issuance hook', async () => {
        await unregisterFromIssuanceModule();
        const isModuleHook = await debtIssuanceModule.isModuleIssuanceHook(matrixTokenAddress, dummyModule.address);
        expect(isModuleHook).is.false;
      });

      describe('when calling module is not registered', async () => {
        before(async () => {
          isRegistered = true;
        });

        after(async () => {
          isRegistered = false;
        });

        it('should revert', async () => {
          await expect(unregisterFromIssuanceModule()).revertedWith('D8');
        });
      });
    });

    context('External debt module has been registered with DebtIssuanceModule', async () => {
      beforeEach(async () => {
        await debtModuleMock.connect(manager).initialize(matrixToken.address);
      });

      describe('getRequiredComponentIssuanceUnits', async () => {
        const debtUnits = ethToWei(100);

        let issueQuantity;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          matrixTokenAddress = matrixToken.address;
          issueQuantity = ethToWei(1);
        });

        async function getRequiredComponentIssuanceUnits() {
          return debtIssuanceModule.getRequiredComponentIssuanceUnits(matrixTokenAddress, issueQuantity);
        }

        it('should return the correct issue token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO];
          const expectedDebtFlows = [ZERO, daiFlows];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });

        it('should return the correct issue token amounts when an additive external equity position is in place', async () => {
          const externalUnits = ethToWei(1);
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(externalUnits));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO];
          const expectedDebtFlows = [ZERO, daiFlows];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });

        it('should return the correct issue token amounts when a non-additive external equity position is in place', async () => {
          const externalUnits = btcToWei(0.5);
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.wbtc.address, externalUnits);
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const btcFlows = preciseMul(mintQuantity, externalUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO, btcFlows];
          const expectedDebtFlows = [ZERO, daiFlows, ZERO];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });
      });

      describe('getRequiredComponentRedemptionUnits', async () => {
        let redeemQuantity;

        const debtUnits = ethToWei(100);

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          matrixTokenAddress = matrixToken.address;
          redeemQuantity = ethToWei(1);
        });

        async function getRequiredComponentRedemptionUnits() {
          return debtIssuanceModule.getRequiredComponentRedemptionUnits(matrixTokenAddress, redeemQuantity);
        }

        it('should return the correct redeem token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnits();

          const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO];
          const expectedDebtFlows = [ZERO, daiFlows];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });

        it('should return the correct redeem token amounts when an additive external equity position is in place', async () => {
          const externalUnits = ethToWei(1);
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);

          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnits();

          const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(externalUnits));

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO];
          const expectedDebtFlows = [ZERO, daiFlows];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });

        it('should return the correct redeem token amounts when a non-additive external equity position is in place', async () => {
          const externalUnits = btcToWei(0.5);
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.wbtc.address, externalUnits);

          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnits();

          const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const wbtcFlows = preciseMul(mintQuantity, externalUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO, wbtcFlows];
          const expectedDebtFlows = [ZERO, daiFlows, ZERO];

          expect(JSON.stringify(components)).eq(JSON.stringify(expectedComponents));
          expect(JSON.stringify(totalEquityUnits)).eq(JSON.stringify(expectedEquityFlows));
          expect(JSON.stringify(totalDebtUnits)).eq(JSON.stringify(expectedDebtFlows));
        });
      });

      describe('issue', async () => {
        const debtUnits = ethToWei(100);

        let to;
        let issueQuantity;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModule.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));
          await systemFixture.weth.approve(debtIssuanceModule.address, totalEquityUnits[0].mul(ethToWei(1.005)));

          matrixTokenAddress = matrixToken.address;
          issueQuantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function issue() {
          return debtIssuanceModule.connect(caller).issue(matrixTokenAddress, issueQuantity, to);
        }

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfTo = await matrixToken.balanceOf(to);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          await issue();

          const newBalanceOfTo = await matrixToken.balanceOf(to);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);

          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
        });

        it('should have called the module issue hook', async () => {
          await issue();
          const result = await debtModuleMock.isModuleIssueHookCalled();
          expect(result).is.true;
        });

        it('should emit the correct IssueMatrixToken event', async () => {
          const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);
          await expect(issue())
            .emit(debtIssuanceModule, 'IssueMatrixToken')
            .withArgs(matrixToken.address, caller.address, to, preIssueHook, issueQuantity, feeQuantity, ZERO);
        });

        it('should have the correct token balances', async () => {
          const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

          await issue();

          const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

          const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));

          expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethFlows);
          expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethFlows);

          expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
          expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });

        it('should revert when the issue quantity is 0', async () => {
          issueQuantity = ZERO;
          await expect(issue()).revertedWith('D2');
        });

        it('should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], owner.address);
          matrixTokenAddress = newToken.address;
          await expect(issue()).revertedWith('M3');
        });

        describe('when an external equity position is in place', async () => {
          const externalUnits = ethToWei(1);

          before(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
          });

          after(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, ZERO);
          });

          it('should have the correct token balances when an external equity position is in place', async () => {
            const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
            const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
            const oldWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

            await issue();

            const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
            const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
            const newWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

            const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
            const wethDefaultFlows = preciseMul(mintQuantity, ethToWei(1));
            const wethExternalFlows = preciseMul(mintQuantity, externalUnits);

            expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethDefaultFlows.add(wethExternalFlows));
            expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethDefaultFlows);
            expect(newWethBalanceOfExternal.sub(oldWethBalanceOfExternal)).eq(wethExternalFlows);

            expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
            expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        describe('when the manager issuance fee is 0', async () => {
          before(async () => {
            issueFee = ZERO;
          });

          after(async () => {
            issueFee = ethToWei(0.005);
          });

          it('should mint MatrixToken to the correct addresses when the manager issuance fee is 0', async () => {
            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            await issue();
            const newBalanceOfTo = await matrixToken.balanceOf(to);
            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
          });

          it('should have the correct token balances when the manager issuance fee is 0', async () => {
            const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
            const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            await issue();

            const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
            const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

            const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
            const wethDefaultFlows = preciseMul(mintQuantity, ethToWei(1));

            expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethDefaultFlows);
            expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethDefaultFlows);

            expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
            expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        describe('when protocol fees are enabled', async () => {
          const protocolFee = ethToWei(0.2);

          beforeEach(async () => {
            await systemFixture.controller.addFee(debtIssuanceModule.address, ZERO, protocolFee);
          });

          it('should mint MatrixToken to the correct addresses when protocol fees are enabled', async () => {
            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
            const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

            await issue();

            const newBalanceOfTo = await matrixToken.balanceOf(to);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
            const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

            const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);
            const protocolSplit = preciseMul(feeQuantity, protocolFee);

            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
            expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(protocolSplit);
            expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity.sub(protocolSplit));
          });
        });

        describe('when manager issuance hook is defined', async () => {
          before(async () => {
            preIssueHook = managerIssuanceHookMock.address;
          });

          after(async () => {
            preIssueHook = ZERO_ADDRESS;
          });

          it('should call the issuance hook', async () => {
            await issue();
            const matrixToken = await managerIssuanceHookMock.getToken();
            expect(matrixToken).eq(matrixTokenAddress);
          });
        });
      });

      describe('redeem', async () => {
        const debtUnits = ethToWei(100);

        let to;
        let redeemQuantity;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModule.getRequiredComponentRedemptionUnits(matrixToken.address, ethToWei(1));

          await systemFixture.weth.approve(debtIssuanceModule.address, totalEquityUnits[0].mul(ethToWei(1.005)));
          await systemFixture.dai.approve(debtIssuanceModule.address, ethToWei(100.5));

          await debtIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

          matrixTokenAddress = matrixToken.address;
          redeemQuantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function redeem() {
          return debtIssuanceModule.connect(caller).redeem(matrixTokenAddress, redeemQuantity, to);
        }

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          await redeem();

          const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(redeemQuantity, redeemFee);

          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
          expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(redeemQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

          const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await redeem();

          const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

          const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const realRedeemQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(redeemFee));
          const daiFlows = preciseMulCeilUint(realRedeemQuantity, debtUnits);
          const wethFlows = preciseMul(realRedeemQuantity, ethToWei(1));

          expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethFlows);
          expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethFlows);

          expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
          expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });

        it('should have called the module issue hook', async () => {
          await redeem();
          const result = await debtModuleMock.isModuleRedeemHookCalled();
          expect(result).is.true;
        });

        it('should emit the correct RedeemMatrixToken event', async () => {
          const feeQuantity = preciseMulCeilUint(redeemQuantity, issueFee);
          await expect(redeem())
            .emit(debtIssuanceModule, 'RedeemMatrixToken')
            .withArgs(matrixToken.address, caller.address, to, redeemQuantity, feeQuantity, ZERO);
        });

        it('should revert when the redeem quantity is 0', async () => {
          redeemQuantity = ZERO;
          await expect(redeem()).revertedWith('D3');
        });

        it('should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], owner.address);
          matrixTokenAddress = newToken.address;
          await expect(redeem()).revertedWith('M3');
        });

        describe('when an external equity position is in place', async () => {
          const externalUnits = ethToWei(1);

          before(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
          });

          after(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, ZERO);
          });

          it('should have the correct token balances when an external equity position is in place', async () => {
            const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
            const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
            const oldWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

            const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            await redeem();

            const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
            const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
            const newWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

            const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const realRedeemQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(redeemFee));
            const daiFlows = preciseMulCeilUint(realRedeemQuantity, debtUnits);
            const wethExternalFlows = preciseMul(realRedeemQuantity, externalUnits);
            const wethDefaultFlows = preciseMul(realRedeemQuantity, ethToWei(1));

            expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethExternalFlows.add(wethDefaultFlows));
            expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethDefaultFlows);
            expect(oldWethBalanceOfExternal.sub(newWethBalanceOfExternal)).eq(wethExternalFlows);

            expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
            expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        describe('when the manager redemption fee is 0', async () => {
          before(async () => {
            redeemFee = ZERO;
          });

          after(async () => {
            redeemFee = ethToWei(0.005);
          });

          it('should mint MatrixToken to the correct addresses when the manager redemption fee is 0', async () => {
            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            await redeem();
            const newBalanceOfTo = await matrixToken.balanceOf(to);
            expect(newBalanceOfTo).eq(oldBalanceOfTo);
          });

          it('should have the correct token balances when the manager redemption fee is 0', async () => {
            const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
            const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

            await redeem();

            const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
            const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);

            const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const realRedeemQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(redeemFee));
            const daiFlows = preciseMulCeilUint(realRedeemQuantity, debtUnits);
            const wethFlows = preciseMul(realRedeemQuantity, ethToWei(1));

            expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethFlows);
            expect(newWethBalanceOfMatrix).eq(oldWethBalanceOfMatrix.sub(wethFlows));

            expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
            expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        describe('when protocol fees are enabled', async () => {
          const protocolFee = ethToWei(0.2);

          beforeEach(async () => {
            await systemFixture.controller.addFee(debtIssuanceModule.address, ZERO, protocolFee);
          });

          it('should mint MatrixToken to the correct addresses when protocol fees are enabled', async () => {
            const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
            const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

            await redeem();

            const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
            const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

            const feeQuantity = preciseMulCeilUint(redeemQuantity, redeemFee);
            const protocolSplit = preciseMul(feeQuantity, protocolFee);

            expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(redeemQuantity);
            expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(protocolSplit);
            expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity.sub(protocolSplit));
          });
        });
      });

      describe('updateFeeRecipient', async () => {
        let newFeeRecipient;

        beforeEach(async () => {
          newFeeRecipient = recipient.address;
          matrixTokenAddress = matrixToken.address;
          caller = manager;
        });

        async function updateFeeRecipient() {
          return debtIssuanceModule.connect(caller).updateFeeRecipient(matrixTokenAddress, newFeeRecipient);
        }

        it('should have set the new fee recipient address', async () => {
          await updateFeeRecipient();
          const setting = await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress);
          expect(setting.feeRecipient).eq(newFeeRecipient);
        });

        it('should emit the correct UpdateFeeRecipient event', async () => {
          await expect(updateFeeRecipient()).emit(debtIssuanceModule, 'UpdateFeeRecipient').withArgs(matrixTokenAddress, newFeeRecipient);
        });

        it('should revert when fee recipient address is null address', async () => {
          newFeeRecipient = ZERO_ADDRESS;
          await expect(updateFeeRecipient()).revertedWith('D4a');
        });

        it('should revert when fee recipient address is same address', async () => {
          newFeeRecipient = (await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress)).feeRecipient;
          await expect(updateFeeRecipient()).revertedWith('D4b');
        });

        it('should revert when MatrixToken is not valid', async () => {
          const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], manager.address);
          matrixTokenAddress = newToken.address;
          await expect(updateFeeRecipient()).revertedWith('M1b');
        });

        it('should revert when the caller is not the MatrixToken manager', async () => {
          caller = owner;
          await expect(updateFeeRecipient()).revertedWith('M1a');
        });
      });
    });

    describe('updateIssueFee', async () => {
      let newIssueFee;

      beforeEach(async () => {
        newIssueFee = ethToWei(0.01);
        matrixTokenAddress = matrixToken.address;
        caller = manager;
      });

      async function updateIssueFee() {
        return debtIssuanceModule.connect(caller).updateIssueFee(matrixTokenAddress, newIssueFee);
      }

      it('should have set the new fee recipient address', async () => {
        await updateIssueFee();
        const setting = await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress);
        expect(setting.managerIssueFee).eq(newIssueFee);
      });

      it('should emit the correct UpdateIssueFee event', async () => {
        await expect(updateIssueFee()).emit(debtIssuanceModule, 'UpdateIssueFee').withArgs(matrixTokenAddress, newIssueFee);
      });

      it('should revert when new issue fee is greater than max fee', async () => {
        newIssueFee = ethToWei(0.03);
        await expect(updateIssueFee()).revertedWith('D5a');
      });

      it('should revert when issue fee is same amount', async () => {
        newIssueFee = (await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress)).managerIssueFee;
        await expect(updateIssueFee()).revertedWith('D5b');
      });

      it('should revert when MatrixToken is not valid', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], manager.address);
        matrixTokenAddress = newToken.address;
        await expect(updateIssueFee()).revertedWith('M1b');
      });

      it('should revert when the caller is not the MatrixToken manager', async () => {
        caller = owner;
        await expect(updateIssueFee()).revertedWith('M1a');
      });
    });

    describe('updateRedeemFee', async () => {
      let newRedeemFee;

      beforeEach(async () => {
        newRedeemFee = ethToWei(0.01);
        matrixTokenAddress = matrixToken.address;
        caller = manager;
      });

      async function updateRedeemFee() {
        return debtIssuanceModule.connect(caller).updateRedeemFee(matrixTokenAddress, newRedeemFee);
      }

      it('should have set the new fee recipient address', async () => {
        await updateRedeemFee();
        const setting = await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress);
        expect(setting.managerRedeemFee).eq(newRedeemFee);
      });

      it('should emit the correct UpdateRedeemFee event', async () => {
        await expect(updateRedeemFee()).emit(debtIssuanceModule, 'UpdateRedeemFee').withArgs(matrixTokenAddress, newRedeemFee);
      });

      it('should revert when new redeem fee is greater than max fee', async () => {
        newRedeemFee = ethToWei(0.03);
        await expect(updateRedeemFee()).revertedWith('D6a');
      });

      it('should revert when redeem fee is same amount', async () => {
        newRedeemFee = (await debtIssuanceModule.getIssuanceSetting(matrixTokenAddress)).managerRedeemFee;
        await expect(updateRedeemFee()).revertedWith('D6b');
      });

      it('should revert when MatrixToken is not valid', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [debtIssuanceModule.address], manager.address);
        matrixTokenAddress = newToken.address;
        await expect(updateRedeemFee()).revertedWith('M1b');
      });

      it('should revert when the caller is not the MatrixToken manager', async () => {
        caller = owner;
        await expect(updateRedeemFee()).revertedWith('M1a');
      });
    });
  });
});
