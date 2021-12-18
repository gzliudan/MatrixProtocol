// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../helpers/deploy');
const { getSigners } = require('../../helpers/accountUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ZERO, ZERO_ADDRESS } = require('../../helpers/constants');
const { ethToWei, btcToWei, usdToWei } = require('../../helpers/unitUtil');
const { preciseMul, preciseMulCeilUint } = require('../../helpers/mathUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract SlippageIssuanceModule', async () => {
  const [owner, manager, protocolFeeRecipient, feeRecipient, recipient] = await getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let matrixToken;
  let matrixTokenAddress;
  let debtModuleMock; // DebtModuleMock
  let externalPositionModule; // ModuleIssuanceHookMock
  let managerIssuanceHookMock; // ManagerIssuanceHookMock
  let slippageIssuance; // SlippageIssuanceModule

  let preIssueHook;
  let initialize;
  let maxFee;
  let issueFee;
  let redeemFee;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    slippageIssuance = await deployContract('SlippageIssuanceModule', [systemFixture.controller.address], owner);
    debtModuleMock = await deployContract('DebtModuleMock', [systemFixture.controller.address, slippageIssuance.address], owner);
    externalPositionModule = await deployContract('ModuleIssuanceHookMock', [], owner);
    managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);

    await systemFixture.controller.addModule(slippageIssuance.address);
    await systemFixture.controller.addModule(debtModuleMock.address);
    await systemFixture.controller.addModule(externalPositionModule.address);

    const modules = [systemFixture.basicIssuanceModule.address, slippageIssuance.address, debtModuleMock.address, externalPositionModule.address];
    matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], modules, manager.address, 'DebtToken', 'DBT');

    await externalPositionModule.initialize(matrixToken.address);

    preIssueHook = ZERO_ADDRESS;
    initialize = true;
    maxFee = ethToWei(0.02);
    issueFee = ethToWei(0.005);
    redeemFee = ethToWei(0.005);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  context('External debt module has been registered with SlippageIssuanceModule', async () => {
    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      if (initialize) {
        await slippageIssuance.connect(manager).initialize(matrixToken.address, maxFee, issueFee, redeemFee, feeRecipient.address, preIssueHook);
      }

      await debtModuleMock.connect(manager).initialize(matrixToken.address);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    describe('getRequiredComponentIssuanceUnitsOffChain', async () => {
      const debtUnits = ethToWei(100);

      let issueQuantity;

      beforeEach(async () => {
        issueQuantity = ethToWei(1);
        matrixTokenAddress = matrixToken.address;
        await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
      });

      async function getRequiredComponentIssuanceUnitsOffChain() {
        return slippageIssuance.callStatic.getRequiredComponentIssuanceUnitsOffChain(matrixTokenAddress, issueQuantity);
      }

      it('should return the correct issue token amounts', async () => {
        const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnitsOffChain();

        const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
        const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
        const wethFlows = preciseMul(mintQuantity, ethToWei(1));

        const expectedComponents = await matrixToken.getComponents();
        const expectedEquityFlows = [wethFlows, ZERO];
        const expectedDebtFlows = [ZERO, daiFlows];

        expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
        expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
        expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
      });

      it('should return the correct issue token amounts when an additive external equity position is in place', async () => {
        const externalUnits = ethToWei(1);
        await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);

        const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnitsOffChain();

        const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
        const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
        const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(externalUnits));

        const expectedComponents = await matrixToken.getComponents();
        const expectedEquityFlows = [wethFlows, ZERO];
        const expectedDebtFlows = [ZERO, daiFlows];

        expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
        expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
        expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
      });

      it('should return the correct issue token amounts when a non-additive external equity position is in place', async () => {
        const externalUnits = btcToWei(0.5);
        await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.wbtc.address, externalUnits);

        const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnitsOffChain();

        const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
        const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
        const wethFlows = preciseMul(mintQuantity, ethToWei(1));
        const btcFlows = preciseMul(mintQuantity, externalUnits);

        const expectedComponents = await matrixToken.getComponents();
        const expectedEquityFlows = [wethFlows, ZERO, btcFlows];
        const expectedDebtFlows = [ZERO, daiFlows, ZERO];

        expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
        expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
        expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
      });

      describe('when positional adjustments are needed to account for positions changed during issuance', async () => {
        let ethIssuanceAdjustment;
        let daiDebtAdjustment;

        beforeEach(async () => {
          await debtModuleMock.addEquityIssuanceAdjustment(systemFixture.weth.address, ethIssuanceAdjustment);
          await debtModuleMock.addDebtIssuanceAdjustment(systemFixture.dai.address, daiDebtAdjustment);
        });

        describe('when positional adjustments are positive numbers', async () => {
          before(async () => {
            ethIssuanceAdjustment = ethToWei(0.01);
            daiDebtAdjustment = ethToWei(1.5);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should return the correct issue token amounts', async () => {
            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnitsOffChain();

            const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits.sub(daiDebtAdjustment));
            const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(ethIssuanceAdjustment));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });
        });

        describe('when positional adjustments are negative numbers', async () => {
          before(async () => {
            ethIssuanceAdjustment = ethToWei(0.01).mul(-1);
            daiDebtAdjustment = ethToWei(1.5).mul(-1);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should return the correct issue token amounts', async () => {
            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnitsOffChain();

            const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits.sub(daiDebtAdjustment));
            const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(ethIssuanceAdjustment));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });
        });

        describe('when equity positional adjustments lead to negative results', async () => {
          before(async () => {
            ethIssuanceAdjustment = ethToWei(1.1).mul(-1);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should revert', async () => {
            await expect(getRequiredComponentIssuanceUnitsOffChain()).revertedWith('SafeCast: value must be positive');
          });
        });

        describe('when debt positional adjustments lead to negative results', async () => {
          before(async () => {
            daiDebtAdjustment = ethToWei(101);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should revert', async () => {
            await expect(getRequiredComponentIssuanceUnitsOffChain()).revertedWith('SafeCast: value must be positive');
          });
        });
      });
    });

    describe('getRequiredComponentRedemptionUnitsOffChain', async () => {
      const debtUnits = ethToWei(100);

      let redeemQuantity;

      beforeEach(async () => {
        redeemQuantity = ethToWei(1);
        matrixTokenAddress = matrixToken.address;
        await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
      });

      async function getRequiredComponentRedemptionUnitsOffChain() {
        return slippageIssuance.callStatic.getRequiredComponentRedemptionUnitsOffChain(matrixTokenAddress, redeemQuantity);
      }

      it('should return the correct redeem token amounts', async () => {
        const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnitsOffChain();

        const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
        const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
        const wethFlows = preciseMul(mintQuantity, ethToWei(1));

        const expectedComponents = await matrixToken.getComponents();
        const expectedEquityFlows = [wethFlows, ZERO];
        const expectedDebtFlows = [ZERO, daiFlows];

        expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
        expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
        expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
      });

      describe('when an additive external equity position is in place', async () => {
        const externalUnits = ethToWei(1);

        beforeEach(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
        });

        it('should return the correct redeem token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnitsOffChain();

          const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(externalUnits));

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO];
          const expectedDebtFlows = [ZERO, daiFlows];

          expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
          expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
          expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
        });
      });

      describe('when a non-additive external equity position is in place', async () => {
        const externalUnits = btcToWei(0.5);

        beforeEach(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.wbtc.address, externalUnits);
        });

        it('should return the correct redeem token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnitsOffChain();

          const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const wbtcFlows = preciseMul(mintQuantity, externalUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, ZERO, wbtcFlows];
          const expectedDebtFlows = [ZERO, daiFlows, ZERO];

          expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
          expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
          expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
        });
      });

      describe('when positional adjustments are needed to account for positions changed during redemption', async () => {
        let daiDebtAdjustment;
        let ethIssuanceAdjustment;

        beforeEach(async () => {
          await debtModuleMock.addDebtIssuanceAdjustment(systemFixture.dai.address, daiDebtAdjustment);
          await debtModuleMock.addEquityIssuanceAdjustment(systemFixture.weth.address, ethIssuanceAdjustment);
        });

        describe('when positional adjustments are positive numbers', async () => {
          before(async () => {
            daiDebtAdjustment = ethToWei(1.5);
            ethIssuanceAdjustment = ethToWei(0.01);
          });

          it('should return the correct issue token amounts', async () => {
            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnitsOffChain();

            const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits.sub(daiDebtAdjustment));
            const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(ethIssuanceAdjustment));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });
        });

        describe('when positional adjustments are negative numbers', async () => {
          before(async () => {
            ethIssuanceAdjustment = ethToWei(0.01).mul(-1);
            daiDebtAdjustment = ethToWei(1.5).mul(-1);
          });

          it('should return the correct issue token amounts', async () => {
            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentRedemptionUnitsOffChain();

            const mintQuantity = preciseMul(redeemQuantity, ethToWei(1).sub(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits.sub(daiDebtAdjustment));
            const wethFlows = preciseMul(mintQuantity, ethToWei(1).add(ethIssuanceAdjustment));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });
        });

        describe('when equity positional adjustments lead to negative results', async () => {
          before(async () => {
            ethIssuanceAdjustment = ethToWei(1.1).mul(-1);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should revert', async () => {
            await expect(getRequiredComponentRedemptionUnitsOffChain()).revertedWith('SafeCast: value must be positive');
          });
        });

        describe('when debt positional adjustments lead to negative results', async () => {
          before(async () => {
            daiDebtAdjustment = ethToWei(101);
          });

          after(async () => {
            ethIssuanceAdjustment = ZERO;
            daiDebtAdjustment = ZERO;
          });

          it('should revert', async () => {
            await expect(getRequiredComponentRedemptionUnitsOffChain()).revertedWith('SafeCast: value must be positive');
          });
        });
      });
    });

    describe('issueWithSlippage', async () => {
      const debtUnits = ethToWei(100);

      let to;
      let issueQuantity;
      let checkedComponents;
      let maxTokenAmountsIn;

      beforeEach(async () => {
        caller = owner;
        to = recipient.address;
        checkedComponents = [];
        maxTokenAmountsIn = [];
        issueQuantity = ethToWei(1);
        matrixTokenAddress = matrixToken.address;

        await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
        await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));
        const { totalEquityUnits } = await slippageIssuance.callStatic.getRequiredComponentIssuanceUnitsOffChain(matrixToken.address, ethToWei(1));
        await systemFixture.weth.approve(slippageIssuance.address, totalEquityUnits[0].mul(ethToWei(1.005)));
      });

      async function issueWithSlippage() {
        return slippageIssuance.connect(caller).issueWithSlippage(matrixTokenAddress, issueQuantity, checkedComponents, maxTokenAmountsIn, to);
      }

      it('should mint MatrixToken to the correct addresses', async () => {
        const oldBalanceOfTo = await matrixToken.balanceOf(to);
        const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
        await issueWithSlippage();
        const newBalanceOfTo = await matrixToken.balanceOf(to);
        const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

        const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);

        expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
        expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
      });

      it('should have the correct token balances', async () => {
        const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
        const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
        const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
        const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

        await issueWithSlippage();

        const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
        const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
        const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
        const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
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

      it('should have called the module issue hook', async () => {
        await issueWithSlippage();
        const result = await debtModuleMock.isModuleIssueHookCalled();
        expect(result).is.true;
      });

      it('should emit the correct IssueMatrixToken event', async () => {
        const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);
        await expect(issueWithSlippage())
          .emit(slippageIssuance, 'IssueMatrixToken')
          .withArgs(matrixToken.address, caller.address, to, preIssueHook, issueQuantity, feeQuantity, ZERO);
      });

      describe('when an external equity position is in place', async () => {
        const externalUnits = ethToWei(1);

        before(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
        });

        after(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, ZERO);
        });

        it('should have the correct token balances', async () => {
          const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);
          const oldWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

          await issueWithSlippage();

          const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);
          const newWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethDefaultFlows = preciseMul(mintQuantity, ethToWei(1));
          const wethExternalFlows = preciseMul(mintQuantity, externalUnits);

          expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethDefaultFlows.add(wethExternalFlows));
          expect(newWethBalanceOfExternal.sub(oldWethBalanceOfExternal)).eq(wethExternalFlows);
          expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethDefaultFlows);

          expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
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

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfTo = await matrixToken.balanceOf(to);
          await issueWithSlippage();
          const newBalanceOfTo = await matrixToken.balanceOf(to);
          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await issueWithSlippage();

          const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethDefaultFlows = preciseMul(mintQuantity, ethToWei(1));

          expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethDefaultFlows);
          expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethDefaultFlows);

          expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
          expect(newDaiBalanceOfExternal).eq(oldDaiBalanceOfExternal.sub(daiFlows));
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });
      });

      it('should mint MatrixToken to the correct addresses when protocol fees are enabled', async () => {
        const protocolFee = ethToWei(0.2);
        await systemFixture.controller.addFee(slippageIssuance.address, ZERO, protocolFee);

        const oldBalanceOfTo = await matrixToken.balanceOf(to);
        const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
        const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

        await issueWithSlippage();

        const newBalanceOfTo = await matrixToken.balanceOf(to);
        const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
        const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

        const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);
        const protocolSplit = preciseMul(feeQuantity, protocolFee);

        expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
        expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity.sub(protocolSplit));
        expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(protocolSplit);
      });

      describe('when manager issuance hook is defined', async () => {
        before(async () => {
          preIssueHook = managerIssuanceHookMock.address;
        });

        after(async () => {
          preIssueHook = ZERO_ADDRESS;
        });

        it('should call the issuance hook', async () => {
          await issueWithSlippage();
          const matrixToken = await managerIssuanceHookMock.getToken();
          expect(matrixToken).eq(matrixTokenAddress);
        });
      });

      describe('when a max token amount in is submitted', async () => {
        beforeEach(async () => {
          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const expectedWethFlows = preciseMul(mintQuantity, ethToWei(1));

          checkedComponents = [systemFixture.weth.address];
          maxTokenAmountsIn = [expectedWethFlows];
        });

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfTo = await matrixToken.balanceOf(to);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          await issueWithSlippage();

          const newBalanceOfTo = await matrixToken.balanceOf(to);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(issueQuantity, issueFee);

          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(issueQuantity);
          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const oldWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await issueWithSlippage();

          const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const newWethBalanceOfMinter = await systemFixture.weth.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));

          expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethFlows);
          expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethFlows);

          expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          expect(newDaiBalanceOfExternal).eq(oldDaiBalanceOfExternal.sub(daiFlows));
        });

        it('should revert but the required amount exceeds the max limit', async () => {
          const mintQuantity = preciseMul(issueQuantity, ethToWei(1).add(issueFee));
          const expectedWethFlows = preciseMul(mintQuantity, ethToWei(1));

          checkedComponents = [systemFixture.weth.address];
          maxTokenAmountsIn = [expectedWethFlows.sub(1)];
          await expect(issueWithSlippage()).revertedWith('SI0b');
        });

        it('should revert but a specified component is not part of the MatrixToken', async () => {
          checkedComponents = [systemFixture.usdc.address];
          maxTokenAmountsIn = [usdToWei(100)];
          await expect(issueWithSlippage()).revertedWith('SI0a');
        });

        it('should revert but the array lengths mismatch', async () => {
          checkedComponents = [systemFixture.weth.address];
          maxTokenAmountsIn = [];
          await expect(issueWithSlippage()).revertedWith('SI1b');
        });

        it('should revert but there are duplicates in the components array', async () => {
          checkedComponents = [systemFixture.weth.address, systemFixture.weth.address];
          maxTokenAmountsIn = [ethToWei(1), ethToWei(1)];
          await expect(issueWithSlippage()).revertedWith('SI1c');
        });
      });

      it('should revert when the issue quantity is 0', async () => {
        issueQuantity = ZERO;
        await expect(issueWithSlippage()).revertedWith('SI1a');
      });

      it('should revert when the MatrixToken is not enabled on the controller', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [slippageIssuance.address], owner.address);
        matrixTokenAddress = newToken.address;
        await expect(issueWithSlippage()).revertedWith('M3');
      });
    });

    describe('redeemWithSlippage', async () => {
      const debtUnits = ethToWei(100);

      let to;
      let testRedeemQuantity;
      let checkedComponents;
      let minTokenAmountsOut;

      beforeEach(async () => {
        await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
        await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));
        const { totalEquityUnits } = await slippageIssuance.callStatic.getRequiredComponentRedemptionUnitsOffChain(matrixToken.address, ethToWei(1));

        await systemFixture.dai.approve(slippageIssuance.address, ethToWei(100.5));
        await systemFixture.weth.approve(slippageIssuance.address, totalEquityUnits[0].mul(ethToWei(1.005)));

        await slippageIssuance.issue(matrixToken.address, ethToWei(1), owner.address);

        caller = owner;
        to = recipient.address;
        checkedComponents = [];
        minTokenAmountsOut = [];
        testRedeemQuantity = ethToWei(1);
        matrixTokenAddress = matrixToken.address;
      });

      async function redeemWithSlippage() {
        return slippageIssuance.connect(caller).redeemWithSlippage(matrixTokenAddress, testRedeemQuantity, checkedComponents, minTokenAmountsOut, to);
      }

      it('should redeem MatrixToken to the correct addresses', async () => {
        const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
        const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

        await redeemWithSlippage();

        const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
        const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

        const feeQuantity = preciseMulCeilUint(testRedeemQuantity, redeemFee);

        expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
        expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(testRedeemQuantity);
      });

      it('should have the correct token balances', async () => {
        const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
        const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
        const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
        const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

        await redeemWithSlippage();

        const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
        const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
        const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
        const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
        const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

        const redeemQuantity = preciseMul(testRedeemQuantity, ethToWei(1).sub(redeemFee));
        const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
        const wethFlows = preciseMul(redeemQuantity, ethToWei(1));

        expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethFlows);
        expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethFlows);

        expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
        expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
        expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
      });

      it('should have called the module issue hook', async () => {
        await redeemWithSlippage();
        const hookCalled = await debtModuleMock.isModuleRedeemHookCalled();
        expect(hookCalled).is.true;
      });

      it('should emit the correct RedeemMatrixToken event', async () => {
        const feeQuantity = preciseMulCeilUint(testRedeemQuantity, issueFee);
        await expect(redeemWithSlippage())
          .emit(slippageIssuance, 'RedeemMatrixToken')
          .withArgs(matrixToken.address, caller.address, to, testRedeemQuantity, feeQuantity, ZERO);
      });

      describe('when an external equity position is in place', async () => {
        const externalUnits = ethToWei(1);

        before(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, externalUnits);
        });

        after(async () => {
          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.weth.address, ZERO);
        });

        it('should have the correct token balances', async () => {
          const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);
          const oldWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

          await redeemWithSlippage();

          const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);
          const newWethBalanceOfExternal = await systemFixture.weth.balanceOf(externalPositionModule.address);

          const redeemQuantity = preciseMul(testRedeemQuantity, ethToWei(1).sub(redeemFee));
          const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
          const wethExternalFlows = preciseMul(redeemQuantity, externalUnits);
          const wethDefaultFlows = preciseMul(redeemQuantity, ethToWei(1));

          expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethExternalFlows.add(wethDefaultFlows));
          expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethDefaultFlows);
          expect(oldWethBalanceOfExternal.sub(newWethBalanceOfExternal)).eq(wethExternalFlows);

          expect(newDaiBalanceOfRedeemer).eq(oldDaiBalanceOfRedeemer.sub(daiFlows));
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

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfTo = await matrixToken.balanceOf(to);
          await redeemWithSlippage();
          const newBalanceOfTo = await matrixToken.balanceOf(to);
          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(ZERO);
        });

        it('should have the correct token balances', async () => {
          const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await redeemWithSlippage();

          const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const redeemQuantity = preciseMul(testRedeemQuantity, ethToWei(1).sub(redeemFee));
          const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
          const wethFlows = preciseMul(redeemQuantity, ethToWei(1));

          expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethFlows);
          expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethFlows);

          expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
          expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });
      });

      it('should mint MatrixToken to the correct addresses when protocol fees are enabled', async () => {
        const protocolFee = ethToWei(0.2);
        await systemFixture.controller.addFee(slippageIssuance.address, ZERO, protocolFee);

        const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
        const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
        const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

        await redeemWithSlippage();

        const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
        const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
        const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

        const feeQuantity = preciseMulCeilUint(testRedeemQuantity, redeemFee);
        const protocolSplit = preciseMul(feeQuantity, protocolFee);

        expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(testRedeemQuantity);
        expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity.sub(protocolSplit));
        expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(protocolSplit);
      });

      describe('when a min token amount out is submitted', async () => {
        beforeEach(async () => {
          const mintQuantity = preciseMul(testRedeemQuantity, ethToWei(1).sub(issueFee));
          const expectedWethFlows = preciseMul(mintQuantity, ethToWei(1));

          checkedComponents = [systemFixture.weth.address];
          minTokenAmountsOut = [expectedWethFlows];
        });

        it('should redeem MatrixToken to the correct addresses', async () => {
          const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          await redeemWithSlippage();

          const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(testRedeemQuantity, redeemFee);

          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
          expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(testRedeemQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await redeemWithSlippage();

          const newWethBalanceOfTo = await systemFixture.weth.balanceOf(to);
          const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const redeemQuantity = preciseMul(testRedeemQuantity, ethToWei(1).sub(redeemFee));
          const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
          const wethFlows = preciseMul(redeemQuantity, ethToWei(1));

          expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethFlows);
          expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethFlows);

          expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
          expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });

        it('should revert but the returned amount is not enough', async () => {
          const mintQuantity = preciseMul(testRedeemQuantity, ethToWei(1).add(issueFee));
          const expectedWethFlows = preciseMul(mintQuantity, ethToWei(1));
          checkedComponents = [systemFixture.weth.address];
          minTokenAmountsOut = [expectedWethFlows.add(1)];
          await expect(redeemWithSlippage()).revertedWith('SI0c');
        });

        it('should revert but a specified component is not part of the Set', async () => {
          checkedComponents = [systemFixture.usdc.address];
          minTokenAmountsOut = [usdToWei(100)];
          await expect(redeemWithSlippage()).revertedWith('SI0a');
        });

        it('should revert but the array lengths mismatch', async () => {
          checkedComponents = [systemFixture.weth.address];
          minTokenAmountsOut = [];
          await expect(redeemWithSlippage()).revertedWith('SI1b');
        });

        it('should revert but there are duplicated in the components array', async () => {
          checkedComponents = [systemFixture.weth.address, systemFixture.weth.address];
          minTokenAmountsOut = [ethToWei(1), ethToWei(1)];
          await expect(redeemWithSlippage()).revertedWith('SI1c');
        });
      });

      it('should revert when the redeem quantity is 0', async () => {
        testRedeemQuantity = ZERO;
        await expect(redeemWithSlippage()).revertedWith('SI1a');
      });

      it('should revert when the MatrixToken is not enabled on the controller', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [slippageIssuance.address], owner.address);
        matrixTokenAddress = newToken.address;
        await expect(redeemWithSlippage()).revertedWith('M3');
      });
    });
  });
});
