// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { compareArray } = require('../helpers/arrayUtil');
const { encodeData, sendEth } = require('../helpers/txUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');
const { getSigners, getEthBalance, getRandomAddress } = require('../helpers/accountUtil');
const { preciseMul, preciseDivFloorInt, preciseMulFloorInt } = require('../helpers/mathUtil');
const { ZERO, ONE, ZERO_ADDRESS, PRECISE_UNIT, EMPTY_BYTES, MODULE_STATE, POSITION_STATE } = require('../helpers/constants');

describe('contract MatrixToken', () => {
  const [owner, feeRecipient, manager, mockBasicIssuanceModule, mockLockedModule, unaddedModule, pendingModule, testAccount, randomAccount] = getSigners();
  const firstComponentUnits = ethToWei(1);
  const secondComponentUnits = ethToWei(2);
  const matrixName = 'TestMatrixToken';
  const matrixSymbol = 'TMT';

  let caller;
  let controller;
  let matrixToken;
  let firstComponent;
  let secondComponent;
  let components;
  let modules;
  let units;

  function shouldRevertIfModuleDisabled(aTestFun) {
    describe('when the calling module is disabled', () => {
      let snapshotId;
      beforeEach(async () => {
        snapshotId = await snapshotBlockchain();
      });

      afterEach(async () => {
        revertBlockchain(snapshotId);
      });

      it('should revert when the calling module is disabled', async () => {
        await controller.removeModule(mockBasicIssuanceModule.address);
        await expect(aTestFun()).revertedWith('T11b');
      });
    });
  }

  function shouldRevertIfCallerIsNotModule(aTestFun) {
    it('should revert when the caller is not a module', async () => {
      caller = randomAccount;
      await expect(aTestFun()).revertedWith('T11a');
    });
  }

  function shouldRevertIfMatrixTokenIsLocked(aTestFun) {
    describe('when the MatrixToken is locked', () => {
      let snapshotId;
      beforeEach(async () => {
        snapshotId = await snapshotBlockchain();
      });

      afterEach(async () => {
        revertBlockchain(snapshotId);
      });

      it('should revert when the MatrixToken is locked', async () => {
        await matrixToken.connect(mockLockedModule).lock();
        await expect(aTestFun()).revertedWith('T13');
      });
    });
  }

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', () => {
    before(async () => {
      firstComponent = await deployContract('Erc20Mock', ['First', 'MOCK', 18], owner);
      secondComponent = await deployContract('Erc20Mock', ['Second', 'MOCK', 18], owner);
      controller = await deployContract('Controller', [feeRecipient.address], owner);

      components = [firstComponent.address, secondComponent.address];
      units = [firstComponentUnits, secondComponentUnits];
      modules = [mockBasicIssuanceModule.address, mockLockedModule.address];

      matrixToken = await deployContract('MatrixToken', [components, units, modules, controller.address, manager.address, matrixName, matrixSymbol], owner);
    });

    it('should have the correct controller', async () => {
      const result = await matrixToken.getController();
      expect(result).eq(controller.address);
    });

    it('should have the correct manager', async () => {
      const result = await matrixToken.getManager();
      expect(result).eq(manager.address);
    });

    it('should have the correct name', async () => {
      const result = await matrixToken.name();
      expect(result).eq(matrixName);
    });

    it('should have the correct symbol', async () => {
      const result = await matrixToken.symbol();
      expect(result).eq(matrixSymbol);
    });

    it('should have the correct multiplier', async () => {
      const result = await matrixToken.getPositionMultiplier();
      expect(result).eq(PRECISE_UNIT);
    });

    it('should have the 0 modules initialized', async () => {
      const result = await matrixToken.getModules();
      expect(result.length).eq(0);
    });

    it('should BasicIssuanceModule is in pending state', async () => {
      const result = await matrixToken.getModuleState(mockBasicIssuanceModule.address);
      expect(result).eq(MODULE_STATE['PENDING']);
    });

    it('should LockedModule is in pending state', async () => {
      const result = await matrixToken.getModuleState(mockLockedModule.address);
      expect(result).eq(MODULE_STATE['PENDING']);
    });

    it(`should first component's default position has the correct real uint`, async () => {
      const firstComponent = await matrixToken.getComponent(0);
      const result = await matrixToken.getDefaultPositionRealUnit(firstComponent);
      expect(result).eq(firstComponentUnits);
    });

    it('should first component has no external position modules', async () => {
      const firstComponent = await matrixToken.getComponent(0);
      const result = await matrixToken.getExternalPositionModules(firstComponent);
      expect(result.length).eq(ZERO);
    });

    it(`should second component's default position has the correct real unit`, async () => {
      const secondComponent = await matrixToken.getComponent(1);
      const result = await matrixToken.getDefaultPositionRealUnit(secondComponent);
      expect(result).eq(secondComponentUnits);
    });

    it('should second component has no external position modules', async () => {
      const secondComponent = await matrixToken.getComponent(1);
      const result = await matrixToken.getExternalPositionModules(secondComponent);
      expect(result.length).eq(ZERO);
    });
  });

  describe('when there is a deployed MatrixToken', () => {
    before(async () => {
      await controller.initialize([], modules, [], []);
      await matrixToken.connect(mockBasicIssuanceModule).initializeModule();
      await matrixToken.connect(mockLockedModule).initializeModule();
    });

    describe('invoke', () => {
      let testSpender;
      let burnQuantity;
      let callData;
      let target;
      let value;

      async function invoke() {
        return await matrixToken.connect(caller).invoke(target, value, callData);
      }

      beforeEach(async () => {
        value = 0;
        burnQuantity = 100;
        target = firstComponent.address;
        caller = mockBasicIssuanceModule;
        testSpender = await getRandomAddress();
        callData = encodeData(firstComponent, 'approve', [testSpender, burnQuantity]);
      });

      context('group 1', async () => {
        let snapshotId;
        before(async () => {
          snapshotId = await snapshotBlockchain();
        });

        after(async () => {
          await revertBlockchain(snapshotId);
        });

        it('should revert when the caller is not a module', async () => {
          caller = testAccount;
          await expect(invoke()).revertedWith('T11a');
        });

        it('should set the MatrixToken approval balance to the spender', async () => {
          await invoke();
          const result = await firstComponent.allowance(matrixToken.address, testSpender);
          expect(result).eq(burnQuantity);
        });

        it('should emit the Invoke event', async () => {
          const expectedReturnValue = '0x0000000000000000000000000000000000000000000000000000000000000001';
          await expect(invoke()).emit(matrixToken, 'Invoke').withArgs(target, 0, callData, expectedReturnValue);
        });

        it('should properly receive and send ETH when sending ETH to another MatrixToken', async () => {
          const newToken = await deployContract(
            'MatrixToken',
            [components, units, modules, controller.address, manager.address, matrixName, matrixSymbol],
            owner
          );
          value = ethToWei(2);
          callData = EMPTY_BYTES;
          target = newToken.address;
          await sendEth(manager, matrixToken.address, value);
          const oldBalance = await getEthBalance(target);
          await invoke();
          const newBalance = await getEthBalance(target);
          expect(newBalance).eq(oldBalance.add(value));
        });
      });

      context('group 2', async () => {
        let snapshotId;
        before(async () => {
          snapshotId = await snapshotBlockchain();
        });

        after(async () => {
          await revertBlockchain(snapshotId);
        });

        it('should not be locked', async () => {
          const result = await matrixToken.isLocked();
          expect(result).is.false;
        });

        it('should be locked when caller is module', async () => {
          await matrixToken.connect(mockLockedModule).lock();
          const result = await matrixToken.isLocked();
          expect(result).is.true;
        });

        it('should revert when the module is locked and caller is not locker', async () => {
          caller = mockBasicIssuanceModule;
          await expect(invoke()).revertedWith('T13');
        });

        it('should invoke ok when the module is locked and caller is locker', async () => {
          caller = mockLockedModule;
          await invoke();
          const result = await firstComponent.allowance(matrixToken.address, testSpender);
          expect(result).eq(burnQuantity);
        });

        it('should be unlocked when caller is locker', async () => {
          await matrixToken.connect(mockLockedModule).unlock();
          const result = await matrixToken.isLocked();
          expect(result).is.false;
        });

        shouldRevertIfModuleDisabled(invoke);
      });
    });

    describe('addComponent', () => {
      let component;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        component = testAccount.address;
        caller = mockBasicIssuanceModule;
      });

      async function addComponent() {
        return await matrixToken.connect(caller).addComponent(component);
      }

      it('should emit the AddComponent event', async () => {
        const prevComponents = await matrixToken.getComponents();
        await expect(addComponent()).emit(matrixToken, 'AddComponent').withArgs(component);
        const components = await matrixToken.getComponents();
        expect(components.length).eq(prevComponents.length + 1);
      });

      it('should add to the component array', async () => {
        const components = await matrixToken.getComponents();
        const expectedComponent = await matrixToken.getComponent(components.length - 1);
        expect(expectedComponent).eq(component);
      });

      it('should revert when there is a an already existing component', async () => {
        await expect(addComponent()).revertedWith('T0');
      });

      shouldRevertIfModuleDisabled(addComponent);
      shouldRevertIfCallerIsNotModule(addComponent);
      shouldRevertIfMatrixTokenIsLocked(addComponent);
    });

    describe('removeComponent', () => {
      let component;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        component = firstComponent.address;
        caller = mockBasicIssuanceModule;
      });

      async function removeComponent() {
        return await matrixToken.connect(caller).removeComponent(component);
      }

      it('should in component list before remove', async () => {
        const components = await matrixToken.getComponents();
        expect(components).contain(component);
      });

      it('should emit the RemoveComponent event', async () => {
        await expect(removeComponent()).emit(matrixToken, 'RemoveComponent').withArgs(component);
      });

      it('should not in component list after remove', async () => {
        const components = await matrixToken.getComponents();
        expect(components).not.contain(component);
      });

      shouldRevertIfModuleDisabled(removeComponent);
      shouldRevertIfCallerIsNotModule(removeComponent);
      shouldRevertIfMatrixTokenIsLocked(removeComponent);
    });

    describe('editDefaultPositionUnit', () => {
      const multiplier = ethToWei(2);

      let component;
      let newUnit;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        component = firstComponent.address;
        newUnit = ethToWei(4);
        caller = mockBasicIssuanceModule;
        await matrixToken.connect(caller).editPositionMultiplier(multiplier);
      });

      async function editDefaultPositionUnit() {
        return await matrixToken.connect(caller).editDefaultPositionUnit(component, newUnit);
      }

      it('should properly edit the default position unit', async () => {
        await editDefaultPositionUnit();
        const result = await matrixToken.getDefaultPositionRealUnit(component);
        expect(result).eq(newUnit);
      });

      it('should emit the EditDefaultPositionUnit event', async () => {
        await expect(editDefaultPositionUnit()).emit(matrixToken, 'EditDefaultPositionUnit').withArgs(component, newUnit);
      });

      it('should properly edit the default position unit when the value is 0', async () => {
        newUnit = ZERO;
        await editDefaultPositionUnit();
        const result = await matrixToken.getDefaultPositionRealUnit(component);
        expect(result).eq(newUnit);
      });

      it('should revert when the conversion results in a virtual unit of 0', async () => {
        newUnit = BigNumber.from(10 ** 2);
        const hugePositionMultiplier = ethToWei(1000000);
        await matrixToken.connect(caller).editPositionMultiplier(hugePositionMultiplier);
        await expect(editDefaultPositionUnit()).revertedWith('T9a');
      });

      it('should revert when the conversion back to real units would round down to 0', async () => {
        newUnit = BigNumber.from(1);
        const hugePositionMultiplier = ethToWei(0.99);
        await matrixToken.connect(caller).editPositionMultiplier(hugePositionMultiplier);
        await expect(editDefaultPositionUnit()).revertedWith('T9b');
      });

      shouldRevertIfModuleDisabled(editDefaultPositionUnit);
      shouldRevertIfCallerIsNotModule(editDefaultPositionUnit);
      shouldRevertIfMatrixTokenIsLocked(editDefaultPositionUnit);
    });

    describe('addExternalPositionModule', () => {
      let component;
      let externalModule;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        component = firstComponent.address;
        externalModule = mockBasicIssuanceModule.address;
        caller = mockBasicIssuanceModule;
      });

      async function addExternalPositionModule() {
        return await matrixToken.connect(caller).addExternalPositionModule(component, externalModule);
      }

      it('should not in external position module list before add the module', async () => {
        const result = await matrixToken.getExternalPositionModules(component);
        expect(result).not.contain(externalModule);
      });

      it('should emit the AddPositionModule event', async () => {
        await expect(addExternalPositionModule()).emit(matrixToken, 'AddPositionModule').withArgs(component, externalModule);
      });

      it('should in external position module list after add the module', async () => {
        const externalModules = await matrixToken.getExternalPositionModules(component);
        const result = externalModules[externalModules.length - 1];
        expect(result).eq(externalModule);
      });

      it('should revert when there is a an already existing component', async () => {
        await expect(addExternalPositionModule()).revertedWith('T1');
      });

      shouldRevertIfModuleDisabled(addExternalPositionModule);
      shouldRevertIfCallerIsNotModule(addExternalPositionModule);
      shouldRevertIfMatrixTokenIsLocked(addExternalPositionModule);
    });

    describe('removeExternalPositionModule', () => {
      let component;
      let externalModule;

      function resetEnviroment() {
        caller = mockBasicIssuanceModule;
        component = firstComponent.address;
        externalModule = mockBasicIssuanceModule.address;
      }

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        resetEnviroment();
        await matrixToken.connect(caller).addExternalPositionModule(component, externalModule);
      });

      beforeEach(async () => {
        resetEnviroment();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      async function removeExternalPositionModule() {
        return await matrixToken.connect(caller).removeExternalPositionModule(component, externalModule);
      }

      it('should be in list before remove the module from externalPositionModules', async () => {
        const result = await matrixToken.getExternalPositionModules(component);
        expect(result).contain(externalModule);
      });

      it('should emit the RemovePositionModule event', async () => {
        await expect(removeExternalPositionModule()).emit(matrixToken, 'RemovePositionModule').withArgs(component, externalModule);
      });

      it('should not in list after remove the module from externalPositionModules', async () => {
        const result = await matrixToken.getExternalPositionModules(component);
        expect(result).not.contain(externalModule);
      });

      it('should zero out real uint in externalPositions after remove', async () => {
        const result = await matrixToken.getExternalPositionRealUnit(component, externalModule);
        expect(result).eq(ZERO);
      });

      it('should zero out the data in externalPositions after remove', async () => {
        const result = await matrixToken.getExternalPositionData(component, externalModule);
        expect(result).eq(EMPTY_BYTES);
      });

      shouldRevertIfModuleDisabled(removeExternalPositionModule);
      shouldRevertIfCallerIsNotModule(removeExternalPositionModule);
      shouldRevertIfMatrixTokenIsLocked(removeExternalPositionModule);
    });

    describe('editExternalPositionUnit', () => {
      const multiplier = ethToWei(2);

      let component;
      let module;
      let newUnit;

      async function editExternalPositionUnit() {
        return await matrixToken.connect(caller).editExternalPositionUnit(component, module, newUnit);
      }

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        component = firstComponent.address;
        module = await getRandomAddress();
        newUnit = ethToWei(4);
        caller = mockBasicIssuanceModule;
        await matrixToken.connect(caller).editPositionMultiplier(multiplier);
      });

      it('should properly edit the external position unit', async () => {
        await editExternalPositionUnit();
        const result = await matrixToken.getExternalPositionRealUnit(component, module);
        expect(result).eq(newUnit);
      });

      it('should emit the EditExternalPositionUnit event', async () => {
        await expect(editExternalPositionUnit()).emit(matrixToken, 'EditExternalPositionUnit').withArgs(component, module, newUnit);
      });

      it('should return a conservative value when the conversion results in a virtual unit of -1', async () => {
        newUnit = BigNumber.from(10 ** 2).mul(-1);
        const hugePositionMultiplier = ethToWei(10000);
        await matrixToken.connect(caller).editPositionMultiplier(hugePositionMultiplier);
        await editExternalPositionUnit();
        const expectedStoredVirtualUnit = preciseDivFloorInt(newUnit, hugePositionMultiplier);
        const expectedExternalRealUnit = preciseMulFloorInt(expectedStoredVirtualUnit, hugePositionMultiplier);
        const result = await matrixToken.getExternalPositionRealUnit(component, module);
        expect(result).eq(expectedExternalRealUnit);
      });

      it('should properly edit the default position unit when the value is 0', async () => {
        newUnit = ZERO;
        await editExternalPositionUnit();
        const retrievedUnit = await matrixToken.getExternalPositionRealUnit(component, module);
        expect(retrievedUnit).eq(newUnit);
      });

      it('should revert when the conversion results in a virtual unit of 0 (positive)', async () => {
        newUnit = BigNumber.from(10 ** 2);
        const hugePositionMultiplier = ethToWei(1000000);
        await matrixToken.connect(caller).editPositionMultiplier(hugePositionMultiplier);
        await expect(editExternalPositionUnit()).revertedWith('T9a');
      });

      shouldRevertIfModuleDisabled(editExternalPositionUnit);
      shouldRevertIfCallerIsNotModule(editExternalPositionUnit);
      shouldRevertIfMatrixTokenIsLocked(editExternalPositionUnit);
    });

    describe('editExternalPositionData', () => {
      let component;
      let module;
      let data;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        component = firstComponent.address;
        module = await getRandomAddress();
        data = '0x11';
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = mockBasicIssuanceModule;
      });

      async function editExternalPositionData() {
        return await matrixToken.connect(caller).editExternalPositionData(component, module, data);
      }

      it('should properly edit the external position unit', async () => {
        await editExternalPositionData();
        const result = await matrixToken.getExternalPositionData(component, module);
        expect(result).eq(data);
      });

      it('should emit the EditExternalPositionData event', async () => {
        await expect(editExternalPositionData()).emit(matrixToken, 'EditExternalPositionData').withArgs(component, module, data);
      });

      shouldRevertIfModuleDisabled(editExternalPositionData);
      shouldRevertIfCallerIsNotModule(editExternalPositionData);
      shouldRevertIfMatrixTokenIsLocked(editExternalPositionData);
    });

    describe('editPositionMultiplier', () => {
      let subjectPositionMultiplier;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = mockBasicIssuanceModule;
        subjectPositionMultiplier = ethToWei(2);
      });

      async function editPositionMultiplier() {
        return await matrixToken.connect(caller).editPositionMultiplier(subjectPositionMultiplier);
      }

      it('should update the multiplier', async () => {
        await editPositionMultiplier();
        const result = await matrixToken.getPositionMultiplier();
        expect(result).eq(subjectPositionMultiplier);
      });

      it('should update the real position units', async () => {
        await editPositionMultiplier();
        const result = await matrixToken.getDefaultPositionRealUnit(firstComponent.address);
        const expected = preciseMul(firstComponentUnits, ethToWei(2));
        expect(result).eq(expected);
      });

      it('should emit the correct EditPositionMultiplier event', async () => {
        await expect(editPositionMultiplier()).emit(matrixToken, 'EditPositionMultiplier').withArgs(subjectPositionMultiplier);
      });

      it('should revert when the value is 0', async () => {
        subjectPositionMultiplier = ZERO;
        await expect(editPositionMultiplier()).revertedWith('T10');
      });

      // When positionMultiplier x unit is < 10^18
      it('should revert when the positionMultiplier results in a real position unit = 0', async () => {
        // Set a really small value
        subjectPositionMultiplier = ONE;
        await matrixToken.connect(caller).editDefaultPositionUnit(firstComponent.address, BigNumber.from(10 ** 2));
        await expect(editPositionMultiplier()).revertedWith('T10');
      });

      it('should revert when the caller is not a module', async () => {
        caller = randomAccount;
        await expect(editPositionMultiplier()).revertedWith('T11a');
      });

      it('should revert when the module is locked', async () => {
        await matrixToken.connect(mockLockedModule).lock();
        await expect(editPositionMultiplier()).revertedWith('T13');
      });

      shouldRevertIfModuleDisabled(editPositionMultiplier);
    });

    describe('lock', () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = mockBasicIssuanceModule;
      });

      async function lock() {
        await matrixToken.connect(caller).lock();
      }

      it('should lock the MatrixToken', async () => {
        await lock();
        const result = await matrixToken.isLocked();
        expect(result).is.true;
      });

      it('should set the locker to the module', async () => {
        const result = await matrixToken.getLocker();
        expect(result).eq(mockBasicIssuanceModule.address);
      });

      it('should revert when the caller is not a module', async () => {
        caller = randomAccount;
        await expect(lock()).revertedWith('T11a');
      });

      it('should revert when the MatrixToken is already locked', async () => {
        await expect(lock()).revertedWith('T2');
      });

      shouldRevertIfModuleDisabled(lock);
    });

    describe('unlock', () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        await matrixToken.connect(mockBasicIssuanceModule).lock();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = mockBasicIssuanceModule;
      });

      async function unlock() {
        return await matrixToken.connect(caller).unlock();
      }

      it('should the matrixToken is locked', async () => {
        const result = await matrixToken.isLocked();
        expect(result).is.true;
      });

      it('should revert when the caller is not a module', async () => {
        caller = randomAccount;
        await expect(unlock()).revertedWith('T11a');
      });

      it('should revert when the caller is a module but not the locker', async () => {
        caller = mockLockedModule;
        await expect(unlock()).revertedWith('T3b');
      });

      it('should put the MatrixToken in an unlocked state', async () => {
        await unlock();
        const result = await matrixToken.isLocked();
        expect(result).is.false;
      });

      it('should clear the locker', async () => {
        const result = await matrixToken.getLocker();
        expect(result).eq(ZERO_ADDRESS);
      });

      it('should revert when the MatrixToken is already unlocked', async () => {
        await expect(unlock()).revertedWith('T3a');
      });

      shouldRevertIfModuleDisabled(unlock);
    });

    describe('mint', () => {
      const quantity = ethToWei(3);
      const mintee = manager.address;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = mockBasicIssuanceModule;
      });

      async function mint() {
        return await matrixToken.connect(caller).mint(mintee, quantity);
      }

      it('should revert when the caller is not a module', async () => {
        caller = randomAccount;
        await expect(mint()).revertedWith('T11a');
      });

      it('should mint the correct quantity to the mintee', async () => {
        const oldBalance = await matrixToken.balanceOf(mintee);
        await mint();
        const newBalance = await matrixToken.balanceOf(mintee);
        expect(newBalance).eq(oldBalance.add(quantity));
      });

      it('should mint the correct quantity to the mintee when the module is locked', async () => {
        const oldBalance = await matrixToken.balanceOf(mintee);
        await matrixToken.connect(mockLockedModule).lock();
        caller = mockLockedModule;
        await mint();
        const newBalance = await matrixToken.balanceOf(mintee);
        expect(newBalance).eq(oldBalance.add(quantity));
      });

      it('should revert when the module is locked', async () => {
        await expect(mint()).revertedWith('T13');
      });

      shouldRevertIfModuleDisabled(mint);
    });

    describe('burn', () => {
      const mintQuantity = ethToWei(4);
      const burnQuantity = ethToWei(3);

      let mintee;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        if (await matrixToken.isLocked()) {
          await matrixToken.connect(mockLockedModule).unlock();
        }

        mintee = manager.address;
        caller = mockBasicIssuanceModule;
        await matrixToken.connect(caller).mint(mintee, mintQuantity);
      });

      async function burn() {
        return await matrixToken.connect(caller).burn(mintee, burnQuantity);
      }

      it('should reduce the correct quantity of the mintee', async () => {
        const oldBalance = await matrixToken.balanceOf(mintee);
        await burn();
        const newBalance = await matrixToken.balanceOf(mintee);
        expect(oldBalance).eq(newBalance.add(burnQuantity));
      });

      it('should reduce the correct quantity from the mintee when the module is locked', async () => {
        const oldBalance = await matrixToken.balanceOf(mintee);
        await matrixToken.connect(mockLockedModule).lock();
        caller = mockLockedModule;
        await burn();
        const newBalance = await matrixToken.balanceOf(mintee);
        expect(oldBalance).eq(newBalance.add(burnQuantity));
      });

      it('should revert when the caller is not a module', async () => {
        caller = randomAccount;
        await expect(burn()).revertedWith('T11a');
      });

      it('should revert when the module is locked', async () => {
        await matrixToken.connect(mockLockedModule).lock();
        await expect(burn()).revertedWith('T13');
      });

      shouldRevertIfModuleDisabled(burn);
    });

    describe('addModule', () => {
      let module;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = manager;
        module = testAccount.address;
      });

      async function addModule() {
        return matrixToken.connect(caller).addModule(module);
      }

      it('should revert when the module is not enabled', async () => {
        await expect(addModule()).revertedWith('T6b');
      });

      it('should emit the AddModule event', async () => {
        await controller.addModule(module);
        await expect(addModule()).emit(matrixToken, 'AddModule').withArgs(module);
      });

      it('should change the state to pending', async () => {
        const result = await matrixToken.getModuleState(module);
        expect(result).eq(MODULE_STATE['PENDING']);
      });

      it('should revert when the module is already added', async () => {
        module = mockBasicIssuanceModule.address;
        await expect(addModule()).revertedWith('T6a');
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(addModule()).revertedWith('T12');
      });
    });

    describe('removeModule', () => {
      let module;
      let moduleMock;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        moduleMock = await deployContract('ModuleBaseMock', [controller.address], owner);
        await controller.addModule(moduleMock.address);
        await matrixToken.connect(manager).addModule(moduleMock.address);
        await moduleMock.initializeModuleOnMatrix(matrixToken.address);
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = manager;
        module = moduleMock.address;
      });

      async function removeModule() {
        return matrixToken.connect(caller).removeModule(module);
      }

      it('should not be removed', async () => {
        const isRemoved = await moduleMock.isRemoved();
        expect(isRemoved).is.false;
      });

      it('should in modules list before removed', async () => {
        const result = await matrixToken.getModules();
        expect(result).contain(module);
      });

      it('should revert when the caller is not the manager', async () => {
        caller = await randomAccount;
        await expect(removeModule()).revertedWith('T12');
      });

      it('should emit the RemoveModule event', async () => {
        await expect(removeModule()).emit(matrixToken, 'RemoveModule').withArgs(module);
      });

      it('should be removed', async () => {
        const isRemoved = await moduleMock.isRemoved();
        expect(isRemoved).is.true;
      });

      it('should change the state to NONE', async () => {
        const result = await matrixToken.getModuleState(module);
        expect(result).eq(MODULE_STATE['NONE']);
      });

      it('should be removed from the modules array', async () => {
        const result = await matrixToken.getModules();
        expect(result).not.contain(module);
      });

      it('should revert when the module is not added', async () => {
        module = unaddedModule.address;
        await expect(removeModule()).revertedWith('T7b');
      });

      it('should revert when the module is pending', async () => {
        module = pendingModule.address;
        await controller.addModule(module);
        await matrixToken.connect(manager).addModule(module);
        await expect(removeModule()).revertedWith('T7b');
      });

      it('should revert when the module is locked', async () => {
        await matrixToken.connect(mockLockedModule).lock();
        await expect(removeModule()).revertedWith('T7a');
      });
    });

    describe('removePendingModule', () => {
      let module;
      let moduleMock;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        moduleMock = await deployContract('ModuleBaseMock', [controller.address], owner);
        await controller.addModule(moduleMock.address);
        await matrixToken.connect(manager).addModule(moduleMock.address);
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = manager;
        module = moduleMock.address;
      });

      async function removePendingModule() {
        return matrixToken.connect(caller).removePendingModule(module);
      }

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(removePendingModule()).revertedWith('T12');
      });

      it('should emit the RemovePendingModule event', async () => {
        await expect(removePendingModule()).emit(matrixToken, 'RemovePendingModule').withArgs(module);
      });

      it('should change the state to NONE', async () => {
        const result = await matrixToken.getModuleState(module);
        expect(result).eq(MODULE_STATE['NONE']);
      });

      it('should revert when the module is not pending', async () => {
        module = unaddedModule.address;
        await expect(removePendingModule()).revertedWith('T8b');
      });

      it('should revert when the module is locked', async () => {
        await matrixToken.connect(mockLockedModule).lock();
        await expect(removePendingModule()).revertedWith('T8a');
      });
    });

    describe('setManager', () => {
      const testManager = testAccount.address;
      caller = manager;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      async function setManager() {
        return matrixToken.connect(caller).setManager(testManager);
      }

      it('should emit the EditManager event', async () => {
        await expect(setManager()).emit(matrixToken, 'EditManager').withArgs(manager.address, testManager);
      });

      it('should change the manager', async () => {
        const result = await matrixToken.getManager();
        expect(result).eq(testManager);
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(setManager()).revertedWith('T12');
      });

      it('should revert when the module is locked', async () => {
        caller = testAccount;
        await matrixToken.connect(mockLockedModule).lock();
        await expect(setManager()).revertedWith('T5');
      });
    });

    describe('initializeModule', () => {
      const module = testAccount.address;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        await controller.addModule(module);
        await matrixToken.connect(manager).addModule(module);
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      beforeEach(async () => {
        caller = testAccount;
      });

      async function initializeModule() {
        return matrixToken.connect(caller).initializeModule();
      }

      it('should emit the InitializeModule event', async () => {
        await expect(initializeModule()).emit(matrixToken, 'InitializeModule').withArgs(module);
      });

      it('should add the module to the modules list', async () => {
        const result = await matrixToken.getModules();
        expect(result).contain(module);
      });

      it('should update the module state to initialized', async () => {
        const result = await matrixToken.getModuleState(module);
        expect(result).eq(MODULE_STATE['INITIALIZED']);
      });

      it('should revert when the module is not added', async () => {
        caller = owner;
        await expect(initializeModule()).revertedWith('T4b');
      });

      it('should revert when the module already added', async () => {
        caller = mockBasicIssuanceModule;
        await expect(initializeModule()).revertedWith('T4b');
      });

      it('should revert when the module is locked', async () => {
        await matrixToken.connect(mockBasicIssuanceModule).lock();
        await expect(initializeModule()).revertedWith('T4a');
      });
    });

    describe('getDefaultPositionRealUnit', () => {
      const multiplier = ethToWei(2);

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct components', async () => {
        await matrixToken.connect(mockBasicIssuanceModule).editPositionMultiplier(multiplier);
        const result = await matrixToken.getDefaultPositionRealUnit(secondComponent.address);
        const expected = preciseMul(secondComponentUnits, multiplier);
        expect(result).eq(expected);
      });
    });

    describe('getExternalPositionRealUnit', () => {
      const multiplier = ethToWei(2);
      const externalUnitToAdd = ethToWei(9);

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct components', async () => {
        const component = secondComponent.address;
        const module = mockBasicIssuanceModule.address;
        await matrixToken.connect(mockBasicIssuanceModule).editPositionMultiplier(multiplier);
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionUnit(component, module, externalUnitToAdd);
        const result = await matrixToken.getExternalPositionRealUnit(component, module);
        expect(result).eq(externalUnitToAdd);
      });
    });

    describe('getComponents', () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct components', async () => {
        const result = await matrixToken.getComponents();
        expect(compareArray(result, components)).is.true;
      });
    });

    describe('getExternalPositionModules', () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct modules', async () => {
        const component = secondComponent.address;
        await matrixToken.connect(mockBasicIssuanceModule).addExternalPositionModule(component, mockBasicIssuanceModule.address);
        await matrixToken.connect(mockBasicIssuanceModule).addExternalPositionModule(component, mockLockedModule.address);
        const result = await matrixToken.getExternalPositionModules(component);
        const components = [mockBasicIssuanceModule.address, mockLockedModule.address];
        expect(compareArray(result, components)).is.true;
      });
    });

    describe('getExternalPositionData', () => {
      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should properly edit the external position unit', async () => {
        const component = firstComponent.address;
        const module = mockBasicIssuanceModule.address;
        const expected = '0x11';
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionData(component, module, expected);
        const data = await matrixToken.getExternalPositionData(component, module);
        expect(data).eq(expected);
      });
    });

    describe('getPositions', () => {
      const externalData = '0x11';
      const multiplier = ethToWei(0.5);
      const externalRealUnit = ethToWei(-1);

      let externalComponent;
      let externalModule;

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
        await matrixToken.connect(mockBasicIssuanceModule).editPositionMultiplier(multiplier);
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct first position', async () => {
        const positions = await matrixToken.getPositions();
        const firstPosition = positions[0];
        expect(firstPosition.component).eq(firstComponent.address);
        expect(firstPosition.unit).eq(preciseMul(units[0], multiplier));
        expect(firstPosition.module).eq(ZERO_ADDRESS);
        expect(firstPosition.positionState).eq(POSITION_STATE['DEFAULT']);
        expect(firstPosition.data).eq(EMPTY_BYTES);
      });

      it('should return the correct second position', async () => {
        const positions = await matrixToken.getPositions();
        const secondPosition = positions[1];
        expect(secondPosition.component).eq(secondComponent.address);
        expect(secondPosition.unit).eq(preciseMul(units[1], multiplier));
        expect(secondPosition.module).eq(ZERO_ADDRESS);
        expect(secondPosition.positionState).eq(POSITION_STATE['DEFAULT']);
        expect(secondPosition.data).eq(EMPTY_BYTES);
      });

      it('should have 3 positions after add a external module', async () => {
        // Add a component to the end.
        const erc20Mock = await deployContract('Erc20Mock', ['external', 'MOCK', 18], owner);
        externalComponent = erc20Mock.address;
        await matrixToken.connect(mockBasicIssuanceModule).addComponent(externalComponent);

        // Add module to the component
        externalModule = mockBasicIssuanceModule.address;
        await matrixToken.connect(mockBasicIssuanceModule).addExternalPositionModule(externalComponent, externalModule);
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionUnit(externalComponent, externalModule, externalRealUnit);
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionData(externalComponent, externalModule, externalData);

        const positions = await matrixToken.getPositions();
        expect(positions.length).eq(3);
      });

      it('should have the correct position after add a external module', async () => {
        const positions = await matrixToken.getPositions();
        const thirdPosition = positions[2];
        expect(thirdPosition.component).eq(externalComponent);
        expect(thirdPosition.unit).eq(externalRealUnit);
        expect(thirdPosition.module).eq(externalModule);
        expect(thirdPosition.positionState).eq(POSITION_STATE['EXTERNAL']);
        expect(thirdPosition.data).eq(externalData);
      });
    });

    describe('getModules', () => {
      it('should return the correct modules', async () => {
        const result = await matrixToken.getModules();
        expect(compareArray(result, modules)).is.true;
      });
    });

    describe('getTotalComponentRealUnits', () => {
      const externalRealUnit1 = ethToWei(6);
      const externalRealUnit2 = ethToWei(-1);

      let snapshotId;
      before(async () => {
        snapshotId = await snapshotBlockchain();
      });

      after(async () => {
        await revertBlockchain(snapshotId);
      });

      it('should return the correct value', async () => {
        const component = firstComponent.address;
        const externalModule1 = mockLockedModule.address;
        const externalModule2 = mockBasicIssuanceModule.address;
        await matrixToken.connect(mockBasicIssuanceModule).addExternalPositionModule(component, externalModule1);
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionUnit(component, externalModule1, externalRealUnit1);
        await matrixToken.connect(mockBasicIssuanceModule).addExternalPositionModule(component, externalModule2);
        await matrixToken.connect(mockBasicIssuanceModule).editExternalPositionUnit(component, externalModule2, externalRealUnit2);

        const totalRealUnits = await matrixToken.getTotalComponentRealUnits(component);
        const expectedResult = firstComponentUnits.add(externalRealUnit1).add(externalRealUnit2);
        expect(totalRealUnits).eq(expectedResult);
      });
    });

    describe('isInitializedModule', () => {
      it('should return ture if module is initialized', async () => {
        const result = await matrixToken.isInitializedModule(modules[0]);
        expect(result).is.true;
      });

      it('should return false if module is not initialized', async () => {
        const result = await matrixToken.isInitializedModule(unaddedModule.address);
        expect(result).is.false;
      });
    });
  });
});
