// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../../helpers/unitUtil');
const { deployContract } = require('../../helpers/deploy');
const { getSigners } = require('../../helpers/accountUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ZERO, ONE, ZERO_ADDRESS } = require('../../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');
const { preciseMul, preciseDiv, preciseMulCeilUint } = require('../../helpers/mathUtil');

describe('contract DebtIssuanceModuleV2', () => {
  const [owner, manager, protocolFeeRecipient, feeRecipient, recipient] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let matrixToken;
  let matrixTokenAddress;
  let quantity;
  let errorErc20; // Erc20ErrorMock
  let debtModuleMock; // DebtModuleMock
  let externalPositionModule; // ModuleIssuanceHookMock
  let managerIssuanceHookMock; // ManagerIssuanceHookMock
  let debtIssuanceModuleV2; // DebtIssuanceModuleV2

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();

    errorErc20 = await deployContract('Erc20ErrorMock', [owner.address, ethToWei(1000000), ZERO, 'Token', 'Symbol', 8], owner);
    debtIssuanceModuleV2 = await deployContract('DebtIssuanceModuleV2', [systemFixture.controller.address, 'DebtIssuanceModuleV2'], owner);
    debtModuleMock = await deployContract('DebtModuleMock', [systemFixture.controller.address, debtIssuanceModuleV2.address], owner);
    externalPositionModule = await deployContract('ModuleIssuanceHookMock', [], owner);
    managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);

    await systemFixture.controller.addModule(debtModuleMock.address);
    await systemFixture.controller.addModule(debtIssuanceModuleV2.address);
    await systemFixture.controller.addModule(externalPositionModule.address);

    const modules = [systemFixture.basicIssuanceModule.address, debtIssuanceModuleV2.address, debtModuleMock.address, externalPositionModule.address];
    matrixToken = await systemFixture.createMatrixToken([errorErc20.address], [ethToWei(1)], modules, manager.address, 'DebtToken', 'DBT');
    matrixTokenAddress = matrixToken.address;

    await externalPositionModule.initialize(matrixToken.address);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  context('when DebtIssuanceModuleV2 is initialized', async () => {
    let preIssueHook;
    let maxFee;
    let issueFee;
    let redeemFee;

    before(async () => {
      await errorErc20.setError(ZERO);
      preIssueHook = ZERO_ADDRESS;
      maxFee = ethToWei(0.02);
      issueFee = ethToWei(0.005);
      redeemFee = ethToWei(0.005);
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      await debtIssuanceModuleV2.connect(manager).initialize(matrixToken.address, maxFee, issueFee, redeemFee, feeRecipient.address, preIssueHook);
      await debtModuleMock.connect(manager).initialize(matrixToken.address);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    context('when MatrixToken components do not have any rounding error', async () => {
      // Note: Tests below are an EXACT copy of the tests for DebtIssuanceModule.
      // Only difference is this MatrixToken contains errorErc20 instead of weth as a default position.
      // This is to ensure the DebtIssuanceModuleV2 behaves exactly similar to DebtIssuanceModule
      // when there is no rounding error present in it's constituent components.

      describe('issue', () => {
        const debtUnits = ethToWei(100);

        let to;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));
          const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));
          await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0].mul(ethToWei(1.005)));
          matrixTokenAddress = matrixToken.address;
          quantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function issue() {
          return debtIssuanceModuleV2.connect(caller).issue(matrixTokenAddress, quantity, to);
        }

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
          const oldBalanceOfTo = await matrixToken.balanceOf(to);

          await issue();

          const newBalanceOfTo = await matrixToken.balanceOf(to);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(quantity, issueFee);

          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const oldWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
          const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

          await issue();

          const newWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
          const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

          const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
          const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));

          expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethFlows);
          expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethFlows);

          expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
          expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
          expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
        });

        it('should have called the module issue hook', async () => {
          await issue();
          const result = await debtModuleMock.isModuleIssueHookCalled();
          expect(result).is.true;
        });

        it('should emit the correct IssueMatrixToken event', async () => {
          const feeQuantity = preciseMulCeilUint(quantity, issueFee);
          await expect(issue())
            .emit(debtIssuanceModuleV2, 'IssueMatrixToken')
            .withArgs(matrixToken.address, caller.address, to, preIssueHook, quantity, feeQuantity, ZERO);
        });

        it('should revert when the issue quantity is 0', async () => {
          quantity = ZERO;
          await expect(issue()).revertedWith('Db0');
        });

        it('should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken([errorErc20.address], [ethToWei(1)], [debtIssuanceModuleV2.address], manager.address);
          matrixTokenAddress = newToken.address;
          await expect(issue()).revertedWith('M3');
        });

        describe('when an external equity position is in place', () => {
          const externalUnits = ethToWei(1);

          before(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, externalUnits);
          });

          after(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, ZERO);
          });

          it('should have the correct token balances when an external equity position is in place', async () => {
            const oldWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
            const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);
            const oldWethBalanceOfExternal = await errorErc20.balanceOf(externalPositionModule.address);

            const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            await issue();

            const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const newWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
            const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);
            const newWethBalanceOfExternal = await errorErc20.balanceOf(externalPositionModule.address);

            const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
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

        describe('when the manager issuance fee is 0', () => {
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
            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
          });

          it('should have the correct token balances when the manager issuance fee is 0', async () => {
            const oldDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const oldWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
            const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

            await issue();

            const newWethBalanceOfMinter = await errorErc20.balanceOf(caller.address);
            const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

            const newDaiBalanceOfMinter = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
            const wethDefaultFlows = preciseMul(mintQuantity, ethToWei(1));

            expect(oldWethBalanceOfMinter.sub(newWethBalanceOfMinter)).eq(wethDefaultFlows);
            expect(newWethBalanceOfMatrix.sub(oldWethBalanceOfMatrix)).eq(wethDefaultFlows);

            expect(newDaiBalanceOfMinter.sub(oldDaiBalanceOfMinter)).eq(daiFlows);
            expect(oldDaiBalanceOfExternal.sub(newDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        it('should mint MatrixToken to the correct addresses when protocol fees are enabled', async () => {
          const protocolFee = ethToWei(0.2);
          await systemFixture.controller.addFee(debtIssuanceModuleV2.address, ZERO, protocolFee);

          const oldBalanceOfTo = await matrixToken.balanceOf(to);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
          const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

          await issue();

          const newBalanceOfTo = await matrixToken.balanceOf(to);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
          const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

          const feeQuantity = preciseMulCeilUint(quantity, issueFee);
          const protocolSplit = preciseMul(feeQuantity, protocolFee);

          expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity.sub(protocolSplit));
          expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(protocolSplit);
        });

        describe('when manager issuance hook is defined', () => {
          before(async () => {
            preIssueHook = managerIssuanceHookMock.address;
          });

          after(async () => {
            preIssueHook = ZERO_ADDRESS;
          });

          it('should call the issuance hook when manager issuance hook is defined', async () => {
            await issue();
            const matrixToken = await managerIssuanceHookMock.getToken();
            expect(matrixToken).eq(matrixTokenAddress);
          });
        });
      });

      describe('redeem', () => {
        const debtUnits = ethToWei(100);

        let to;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentRedemptionUnits(matrixToken.address, ethToWei(1));

          await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0].mul(ethToWei(1.005)));
          await systemFixture.dai.approve(debtIssuanceModuleV2.address, ethToWei(100.5));

          await debtIssuanceModuleV2.issue(matrixToken.address, ethToWei(1), owner.address);

          matrixTokenAddress = matrixToken.address;
          quantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function redeem() {
          return debtIssuanceModuleV2.connect(caller).redeem(matrixTokenAddress, quantity, to);
        }

        it('should mint MatrixToken to the correct addresses', async () => {
          const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          await redeem();

          const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

          const feeQuantity = preciseMulCeilUint(quantity, redeemFee);

          expect(oldBalanceOfCaller.sub(newBalanceOfCaller)).eq(quantity);
          expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
        });

        it('should have the correct token balances', async () => {
          const oldWethBalanceOfTo = await errorErc20.balanceOf(to);
          const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

          const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          await redeem();

          const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
          const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
          const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

          const newWethBalanceOfTo = await errorErc20.balanceOf(to);
          const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

          const redeemQuantity = preciseMul(quantity, ethToWei(1).sub(redeemFee));
          const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
          const wethFlows = preciseMul(redeemQuantity, ethToWei(1));

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
          const feeQuantity = preciseMulCeilUint(quantity, issueFee);
          await expect(redeem()).emit(debtIssuanceModuleV2, 'RedeemMatrixToken').withArgs(matrixToken.address, caller.address, to, quantity, feeQuantity, ZERO);
        });

        describe('when an external equity position is in place', () => {
          const externalUnits = ethToWei(1);

          before(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, externalUnits);
          });

          after(async () => {
            await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, ZERO);
          });

          it('should have the correct token balances when an external equity position is in place', async () => {
            const oldWethBalanceOfTo = await errorErc20.balanceOf(to);
            const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);
            const oldWethBalanceOfExternal = await errorErc20.balanceOf(externalPositionModule.address);

            const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            await redeem();

            const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const newWethBalanceOfTo = await errorErc20.balanceOf(to);
            const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);
            const newWethBalanceOfExternal = await errorErc20.balanceOf(externalPositionModule.address);

            const redeemQuantity = preciseMul(quantity, ethToWei(1).sub(redeemFee));
            const daiFlows = preciseMulCeilUint(redeemQuantity, debtUnits);
            const wethExternalFlows = preciseMul(redeemQuantity, externalUnits);
            const wethDefaultFlows = preciseMul(redeemQuantity, ethToWei(1));

            expect(newWethBalanceOfTo.sub(oldWethBalanceOfTo)).eq(wethExternalFlows.add(wethDefaultFlows));
            expect(oldWethBalanceOfMatrix.sub(newWethBalanceOfMatrix)).eq(wethDefaultFlows);
            expect(oldWethBalanceOfExternal.sub(newWethBalanceOfExternal)).eq(wethExternalFlows);

            expect(oldDaiBalanceOfRedeemer.sub(newDaiBalanceOfRedeemer)).eq(daiFlows);
            expect(newDaiBalanceOfExternal.sub(oldDaiBalanceOfExternal)).eq(daiFlows);
            expect(newDaiBalanceOfMatrix).eq(oldDaiBalanceOfMatrix);
          });
        });

        describe('when the manager redemption fee is 0', () => {
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
            const oldWethBalanceOfTo = await errorErc20.balanceOf(to);
            const oldWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

            const oldDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const oldDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const oldDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            await redeem();

            const newWethBalanceOfTo = await errorErc20.balanceOf(to);
            const newWethBalanceOfMatrix = await errorErc20.balanceOf(matrixTokenAddress);

            const newDaiBalanceOfRedeemer = await systemFixture.dai.balanceOf(caller.address);
            const newDaiBalanceOfMatrix = await systemFixture.dai.balanceOf(matrixTokenAddress);
            const newDaiBalanceOfExternal = await systemFixture.dai.balanceOf(debtModuleMock.address);

            const redeemQuantity = preciseMul(quantity, ethToWei(1).sub(redeemFee));
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
          await systemFixture.controller.addFee(debtIssuanceModuleV2.address, ZERO, protocolFee);

          const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
          const oldBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

          await redeem();

          const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
          const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);
          const newBalanceOfProtocol = await matrixToken.balanceOf(protocolFeeRecipientAddress);

          const feeQuantity = preciseMulCeilUint(quantity, redeemFee);
          const protocolSplit = preciseMul(feeQuantity, protocolFee);

          expect(newBalanceOfCaller).eq(oldBalanceOfCaller.sub(quantity));
          expect(newBalanceOfManager).eq(oldBalanceOfManager.add(feeQuantity.sub(protocolSplit)));
          expect(newBalanceOfProtocol).eq(oldBalanceOfProtocol.add(protocolSplit));
        });

        it('should revert when the issue quantity is 0', async () => {
          quantity = ZERO;
          await expect(redeem()).revertedWith('Db1');
        });

        it('should revert when the MatrixToken is not enabled on the controller', async () => {
          const newToken = await systemFixture.createRawMatrixToken([errorErc20.address], [ethToWei(1)], [debtIssuanceModuleV2.address], manager.address);
          matrixTokenAddress = newToken.address;
          await expect(redeem()).revertedWith('M3');
        });
      });

      describe('getRequiredComponentIssuanceUnits', () => {
        const debtUnits = ethToWei(100);

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));
          await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0].mul(ethToWei(1.005)));

          matrixTokenAddress = matrixToken.address;
          quantity = ethToWei(1);

          await debtIssuanceModuleV2.issue(matrixTokenAddress, quantity, owner.address);
        });

        async function getRequiredComponentIssuanceUnits() {
          return debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixTokenAddress, quantity);
        }

        it('should return the correct issue token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
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
          await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, externalUnits);
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
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
          const externalUnits = ethToWei(50);

          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.dai.address, externalUnits);
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
          const daiDebtFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const daiEquityFlows = preciseMul(mintQuantity, externalUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, daiEquityFlows];
          const expectedDebtFlows = [ZERO, daiDebtFlows];

          expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
          expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
          expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
        });
      });
    });

    context('when MatrixToken components do have rounding errors', async () => {
      describe('issue', () => {
        const debtUnits = ethToWei(100);

        let to;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));
          await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0]);

          matrixTokenAddress = matrixToken.address;
          quantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function issue() {
          return debtIssuanceModuleV2.connect(caller).issue(matrixTokenAddress, quantity, to);
        }

        describe('when rounding error is negative one', () => {
          beforeEach(async () => {
            await errorErc20.setError(-1);
          });

          it('should revert when MatrixToken is exactly collateralized when rounding error is negative one', async () => {
            await expect(issue()).revertedWith('IV0');
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is over-collateralized by at least 1 wei', async () => {
            await errorErc20.connect(owner).transfer(matrixToken.address, ONE);

            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await issue();

            const newBalanceOfTo = await matrixToken.balanceOf(to);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, issueFee);

            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
            expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
          });
        });

        describe('when rounding error is positive one', () => {
          beforeEach(async () => {
            await errorErc20.setError(ONE);
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is exactly collateralized', async () => {
            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await issue();

            const newBalanceOfTo = await matrixToken.balanceOf(to);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, issueFee);

            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
            expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is over-collateralized by at least 1 wei', async () => {
            await errorErc20.connect(owner).transfer(matrixToken.address, ONE);

            const oldBalanceOfTo = await matrixToken.balanceOf(to);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await issue();

            const newBalanceOfTo = await matrixToken.balanceOf(to);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, issueFee);

            expect(newBalanceOfTo.sub(oldBalanceOfTo)).eq(quantity);
            expect(newBalanceOfManager.sub(oldBalanceOfManager)).eq(feeQuantity);
          });
        });
      });

      describe('redeem', () => {
        const debtUnits = ethToWei(100);

        let to;

        beforeEach(async () => {
          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));

          const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));

          await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0]);
          await systemFixture.dai.approve(debtIssuanceModuleV2.address, ethToWei(100.5));

          await debtIssuanceModuleV2.issue(matrixToken.address, ethToWei(1), owner.address);

          matrixTokenAddress = matrixToken.address;
          quantity = ethToWei(1);
          to = recipient.address;
          caller = owner;
        });

        async function redeem() {
          return debtIssuanceModuleV2.connect(caller).redeem(matrixTokenAddress, quantity, to);
        }

        describe('when rounding error is negative one', () => {
          beforeEach(async () => {
            await errorErc20.setError(-1);
          });

          it('should revert when MatrixToken is exactly collateralized', async () => {
            await expect(redeem()).revertedWith('IV1');
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is over-collateralized by at least 1 wei', async () => {
            await errorErc20.connect(owner).transfer(matrixToken.address, ONE);

            const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await redeem();

            const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, redeemFee);

            expect(newBalanceOfManager).eq(oldBalanceOfManager.add(feeQuantity));
            expect(newBalanceOfCaller).eq(oldBalanceOfCaller.sub(quantity));
          });
        });

        describe('when rounding error is positive one', () => {
          beforeEach(async () => {
            await errorErc20.setError(ONE);
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is exactly collateralized', async () => {
            const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await redeem();

            const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, redeemFee);

            expect(newBalanceOfManager).eq(oldBalanceOfManager.add(feeQuantity));
            expect(newBalanceOfCaller).eq(oldBalanceOfCaller.sub(quantity));
          });

          it('should mint MatrixToken to the correct addresses when MatrixToken is over-collateralized by at least 1 wei', async () => {
            await errorErc20.connect(owner).transfer(matrixToken.address, ONE);

            const oldBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const oldBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            await redeem();

            const newBalanceOfCaller = await matrixToken.balanceOf(caller.address);
            const newBalanceOfManager = await matrixToken.balanceOf(feeRecipient.address);

            const feeQuantity = preciseMulCeilUint(quantity, redeemFee);

            expect(newBalanceOfManager).eq(oldBalanceOfManager.add(feeQuantity));
            expect(newBalanceOfCaller).eq(oldBalanceOfCaller.sub(quantity));
          });
        });
      });

      describe('getRequiredComponentIssuanceUnits', () => {
        const debtUnits = ethToWei(100);
        const accruedBalance = ethToWei(0.00001);

        beforeEach(async () => {
          quantity = ethToWei(1);
          matrixTokenAddress = matrixToken.address;

          await debtModuleMock.addDebt(matrixToken.address, systemFixture.dai.address, debtUnits);
          await systemFixture.dai.transfer(debtModuleMock.address, ethToWei(100.5));
          await errorErc20.setError(accruedBalance);
        });

        async function getRequiredComponentIssuanceUnits() {
          return debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixTokenAddress, quantity);
        }

        it('should return the correct issue token amounts', async () => {
          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
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

          await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, externalUnits);

          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
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
          const externalUnits = ethToWei(50);

          await externalPositionModule.addExternalPosition(matrixToken.address, systemFixture.dai.address, externalUnits);

          const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

          const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
          const daiDebtFlows = preciseMulCeilUint(mintQuantity, debtUnits);
          const wethFlows = preciseMul(mintQuantity, ethToWei(1));
          const daiEquityFlows = preciseMul(mintQuantity, externalUnits);

          const expectedComponents = await matrixToken.getComponents();
          const expectedEquityFlows = [wethFlows, daiEquityFlows];
          const expectedDebtFlows = [ZERO, daiDebtFlows];

          expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
          expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
          expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
        });

        describe('when tokens have been issued', () => {
          beforeEach(async () => {
            const { totalEquityUnits } = await debtIssuanceModuleV2.getRequiredComponentIssuanceUnits(matrixToken.address, ethToWei(1));
            await errorErc20.approve(debtIssuanceModuleV2.address, totalEquityUnits[0].mul(ethToWei(1.005)));
            await debtIssuanceModuleV2.issue(matrixTokenAddress, quantity, owner.address);
          });

          it('should return the correct issue token amounts', async () => {
            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

            const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMul(mintQuantity, debtUnits);
            const wethFlows = preciseMulCeilUint(mintQuantity, preciseDiv(ethToWei(1.005).add(accruedBalance), ethToWei(1.005)));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });

          it('should return the correct issue token amounts when an additive external equity position is in place', async () => {
            const externalUnits = ethToWei(1);

            await externalPositionModule.addExternalPosition(matrixToken.address, errorErc20.address, externalUnits);

            const { components, totalEquityUnits, totalDebtUnits } = await getRequiredComponentIssuanceUnits();

            const mintQuantity = preciseMul(quantity, ethToWei(1).add(issueFee));
            const daiFlows = preciseMulCeilUint(mintQuantity, debtUnits);
            const wethFlows = preciseMulCeilUint(mintQuantity, preciseDiv(ethToWei(1.005).add(accruedBalance), ethToWei(1.005)).add(externalUnits));

            const expectedComponents = await matrixToken.getComponents();
            const expectedEquityFlows = [wethFlows, ZERO];
            const expectedDebtFlows = [ZERO, daiFlows];

            expect(JSON.stringify(expectedComponents)).eq(JSON.stringify(components));
            expect(JSON.stringify(expectedEquityFlows)).eq(JSON.stringify(totalEquityUnits));
            expect(JSON.stringify(expectedDebtFlows)).eq(JSON.stringify(totalDebtUnits));
          });
        });
      });
    });
  });
});
