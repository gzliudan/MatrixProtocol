// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { getSigners } = require('../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');
const { ZERO_ADDRESS, ZERO, ONE } = require('../helpers/constants');

describe('contract Controller', function () {
  const [owner, protocolFeeRecipient, basicIssuanceModule, matrixTokenFactory, priceOracle, matrixToken, userMock, randomAccount] = getSigners();
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let controller;

  function shouldRevertWhenNotOwner(aTestFun) {
    it('should revert when the caller is not the owner', async function () {
      caller = randomAccount;
      await expect(aTestFun()).revertedWith('C14');
    });
  }

  function shouldRevertWhenNotInit(aTestFun) {
    it('should revert when the module is not initialized', async function () {
      await expect(aTestFun()).revertedWith('C13');
    });
  }

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    controller = await deployContract('Controller', [protocolFeeRecipientAddress], owner);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', function () {
    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    it('should have the correct protocolFeeRecipient address', async function () {
      const result = await controller.getFeeRecipient();
      expect(result).eq(protocolFeeRecipientAddress);
    });

    it('should be returned as a valid system contract', async function () {
      const result = await controller.isSystemContract(controller.address);
      expect(result).is.true;
    });
  });

  describe('initialize', function () {
    let resourceId;
    let factories;
    let modules;
    let resources;
    let resourceIds;

    function resetEnviroment() {
      caller = owner;
      resourceId = BigNumber.from(1);
      factories = [matrixTokenFactory.address];
      modules = [basicIssuanceModule.address];
      resources = [priceOracle.address];
      resourceIds = [resourceId];
    }

    async function initController() {
      return await controller.connect(caller).initialize(factories, modules, resources, resourceIds);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      resetEnviroment();
    });

    context('when not init', async function () {
      after(async function () {
        resetEnviroment();
      });

      shouldRevertWhenNotOwner(initController);

      it("should revert when resource and resourceId lengths don't match", async function () {
        resources = [priceOracle.address];
        resourceIds = [ZERO, ONE];
        await expect(initController()).revertedWith('C0b');
      });

      it('should revert when zero address passed for factory', async function () {
        factories = [ZERO_ADDRESS];
        await expect(initController()).revertedWith('C0c');
      });

      it('should revert when zero address passed for module', async function () {
        modules = [ZERO_ADDRESS];
        await expect(initController()).revertedWith('C0d');
      });

      it('should revert when zero address passed for resource', async function () {
        resources = [ZERO_ADDRESS];
        await expect(initController()).revertedWith('C0e');
      });

      it('should revert when the resourceId already exists', async function () {
        resources = [priceOracle.address, owner.address];
        resourceIds = [resourceId, resourceId];
        await expect(initController()).revertedWith('C0f');
      });
    });

    context('when init OK', async function () {
      before(async function () {
        await initController();
      });

      it('should revert when the Controller is already initialized', async function () {
        await expect(initController()).revertedWith('C0a');
      });

      it('should have set the correct modules length of 1', async function () {
        const result = await controller.getModules();
        expect(result.length).eq(1);
      });

      it('should have set the correct factories length of 1', async function () {
        const result = await controller.getFactories();
        expect(result.length).eq(1);
      });

      it('should have set the correct resources length of 1', async function () {
        const result = await controller.getResources();
        expect(result.length).eq(1);
      });

      it('should have a valid module', async function () {
        const result = await controller.isModule(basicIssuanceModule.address);
        expect(result).is.true;
      });

      it('should have a valid factory', async function () {
        const result = await controller.isFactory(matrixTokenFactory.address);
        expect(result).is.true;
      });

      it('should have a valid resource', async function () {
        const result = await controller.isResource(priceOracle.address);
        expect(result).is.true;
      });

      it('should update the resourceId mapping', async function () {
        const result = await controller.getResource(resourceId);
        expect(result).eq(priceOracle.address);
      });
    });
  });

  describe('addMatrix', function () {
    const matrixTokenAddr = matrixToken.address;

    async function addMatrix() {
      return await controller.connect(caller).addMatrix(matrixTokenAddr);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      caller = matrixTokenFactory;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(addMatrix);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addFactory(matrixTokenFactory.address);
      });

      it('should emit the AddMatrix event', async function () {
        await expect(addMatrix()).emit(controller, 'AddMatrix').withArgs(matrixTokenAddr, caller.address);
      });

      it('should be stored in the matrix array', async function () {
        const result = await controller.getMatrixs();
        expect(result.length).eq(1);
      });

      it('should be returned as a valid matrix', async function () {
        const result = await controller.isMatrix(matrixToken.address);
        expect(result).is.true;
      });

      it('should be returned as a valid system contract', async function () {
        const result = await controller.isSystemContract(matrixToken.address);
        expect(result).is.true;
      });

      it('should revert when the matrix already exists', async function () {
        await expect(addMatrix()).revertedWith('C1');
      });

      it('should revert when the caller is not a factory', async function () {
        caller = randomAccount;
        await expect(addMatrix()).revertedWith('C12');
      });
    });
  });

  describe('removeMatrix', function () {
    const matrixTokenAddr = matrixToken.address;

    async function removeMatrix() {
      return await controller.connect(caller).removeMatrix(matrixTokenAddr);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(removeMatrix);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addFactory(matrixTokenFactory.address);
        await controller.connect(matrixTokenFactory).addMatrix(matrixToken.address);
      });

      shouldRevertWhenNotOwner(removeMatrix);

      it('should emit the RemoveMatrix event', async function () {
        await expect(removeMatrix()).emit(controller, 'RemoveMatrix').withArgs(matrixTokenAddr);
      });

      it('should remove matrix from array', async function () {
        const result = await controller.getMatrixs();
        expect(result.length).eq(0);
      });

      it('should return false as a valid matrix', async function () {
        const result = await controller.isMatrix(matrixToken.address);
        expect(result).is.false;
      });

      it('should return false as a valid system contract', async function () {
        const result = await controller.isSystemContract(matrixToken.address);
        expect(result).is.false;
      });

      it('should revert when the matrix does not exist', async function () {
        await expect(removeMatrix()).revertedWith('C2');
      });
    });
  });

  describe('addFactory', function () {
    let factory;

    async function addFactory() {
      return await controller.connect(caller).addFactory(factory);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      factory = matrixTokenFactory.address;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(addFactory);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
      });

      shouldRevertWhenNotOwner(addFactory);

      it('should emit the AddFactory event', async function () {
        await expect(addFactory()).emit(controller, 'AddFactory').withArgs(factory);
      });

      it('should be stored in the factories array', async function () {
        const result = await controller.getFactories();
        expect(result.length).eq(1);
      });

      it('should be returned as a valid factory', async function () {
        const result = await controller.isFactory(matrixTokenFactory.address);
        expect(result).is.true;
      });

      it('should be returned as a valid system contract', async function () {
        const result = await controller.isSystemContract(matrixTokenFactory.address);
        expect(result).is.true;
      });

      it('should revert when the factory already exists', async function () {
        await expect(addFactory()).revertedWith('C3');
      });
    });
  });

  describe('removeFactory', function () {
    let factory;

    async function removeFactory() {
      return await controller.connect(caller).removeFactory(factory);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      factory = matrixTokenFactory.address;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(removeFactory);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addFactory(matrixTokenFactory.address);
      });

      shouldRevertWhenNotOwner(removeFactory);

      it('should emit the RemoveFactory event', async function () {
        await expect(removeFactory()).emit(controller, 'RemoveFactory').withArgs(factory);
      });

      it('should remove factory from factories array', async function () {
        const result = await controller.getFactories();
        expect(result.length).eq(0);
      });

      it('should return false as a valid factory', async function () {
        const result = await controller.isFactory(matrixTokenFactory.address);
        expect(result).is.false;
      });

      it('should return false as a valid system contract', async function () {
        const result = await controller.isSystemContract(matrixTokenFactory.address);
        expect(result).is.false;
      });

      it('should revert when the factory does not exist', async function () {
        await expect(removeFactory()).revertedWith('C4');
      });
    });
  });

  describe('addModule', function () {
    let module;

    async function addModule() {
      return await controller.connect(caller).addModule(module);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      module = basicIssuanceModule.address;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(addModule);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
      });

      shouldRevertWhenNotOwner(addModule);

      it('should emit the AddModule event', async function () {
        await expect(addModule()).emit(controller, 'AddModule').withArgs(module);
      });

      it('should be stored in the modules array', async function () {
        const result = await controller.getModules();
        expect(result.length).eq(1);
      });

      it('should be returned as a valid module', async function () {
        const result = await controller.isModule(basicIssuanceModule.address);
        expect(result).is.true;
      });

      it('should be returned as a valid system contract', async function () {
        const result = await controller.isSystemContract(basicIssuanceModule.address);
        expect(result).is.true;
      });

      it('should revert when the module already exists', async function () {
        await expect(addModule()).revertedWith('C5');
      });
    });
  });

  describe('removeModule', function () {
    let module;

    async function removeModule() {
      return await controller.connect(caller).removeModule(module);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      module = basicIssuanceModule.address;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(removeModule);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addModule(basicIssuanceModule.address);
      });

      shouldRevertWhenNotOwner(removeModule);

      it('should emit the RemoveModule event', async function () {
        await expect(removeModule()).emit(controller, 'RemoveModule').withArgs(module);
      });

      it('should remove module from modules array', async function () {
        const result = await controller.getModules();
        expect(result.length).eq(0);
      });

      it('should return false as a valid module', async function () {
        const result = await controller.isModule(basicIssuanceModule.address);
        expect(result).is.false;
      });

      it('should return false as a valid system contract', async function () {
        const result = await controller.isSystemContract(basicIssuanceModule.address);
        expect(result).is.false;
      });

      it('should revert when the module does not exist', async function () {
        await expect(removeModule()).revertedWith('C6');
      });
    });
  });

  describe('addResource', function () {
    let resource;
    let resourceId;
    let priceOracleAddress;

    async function addResource() {
      return await controller.connect(caller).addResource(resource, resourceId);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      priceOracleAddress = priceOracle.address;
      resource = priceOracleAddress;
      resourceId = BigNumber.from(0);
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(addResource);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
      });

      shouldRevertWhenNotOwner(addResource);

      it('should emit the AddResource event', async function () {
        await expect(addResource()).emit(controller, 'AddResource').withArgs(resource, resourceId);
      });

      it('should be stored in the resources array', async function () {
        const result = await controller.getResources();
        expect(result.length).eq(1);
      });

      it('should be returned as a valid resource', async function () {
        const result = await controller.isResource(priceOracle.address);
        expect(result).is.true;
      });

      it('should update the resourceId mapping', async function () {
        const result = await controller.getResource(resourceId);
        expect(result).eq(priceOracleAddress);
      });

      it('should be returned as a valid system contract', async function () {
        const result = await controller.isSystemContract(priceOracle.address);
        expect(result).is.true;
      });

      it('should revert when the resource already exists', async function () {
        await expect(addResource()).revertedWith('C7a');
      });

      it('should revert when the resourceId already exists', async function () {
        resource = userMock.address;
        await expect(addResource()).revertedWith('C7b');
      });
    });
  });

  describe('removeResource', function () {
    let resource;
    let resourceId;

    async function removeResource() {
      return await controller.connect(caller).removeResource(resourceId);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      resource = priceOracle.address;
      resourceId = BigNumber.from(0);
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(removeResource);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addResource(resource, resourceId);
      });

      shouldRevertWhenNotOwner(removeResource);

      it('should emit the RemoveResource event', async function () {
        await expect(removeResource()).emit(controller, 'RemoveResource').withArgs(resource, resourceId);
      });

      it('should remove resource from array', async function () {
        const result = await controller.getResources();
        expect(result.length).eq(0);
      });

      it('should return false as a valid resource', async function () {
        const result = await controller.isResource(priceOracle.address);
        expect(result).is.false;
      });

      it('should update the resourceId mapping', async function () {
        const result = await controller.getResource(resourceId);
        expect(result).eq(ZERO_ADDRESS);
      });

      it('should return false as a valid system contract', async function () {
        const result = await controller.isSystemContract(priceOracle.address);
        expect(result).is.false;
      });

      it('should revert when the resource does not exist', async function () {
        await expect(removeResource()).revertedWith('C8');
      });
    });
  });

  describe('addFee', function () {
    let module;
    let feeType;
    let feePercentage;

    async function addFee() {
      return await controller.connect(caller).addFee(module, feeType, feePercentage);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      module = basicIssuanceModule.address;
      feeType = BigNumber.from(1);
      feePercentage = BigNumber.from(5);
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(addFee);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addModule(basicIssuanceModule.address);
      });

      shouldRevertWhenNotOwner(addFee);

      it('should emit the AddFee event', async function () {
        await expect(addFee()).emit(controller, 'AddFee').withArgs(module, feeType, feePercentage);
      });

      it('should be added to the fees mapping', async function () {
        const result = await controller.getModuleFee(basicIssuanceModule.address, BigNumber.from(1));
        expect(result).eq(5);
      });

      it('should revert when the module does not exist', async function () {
        module = userMock.address;
        await expect(addFee()).revertedWith('C9a');
      });

      it('should revert when the feeType already exists on the module', async function () {
        await expect(addFee()).revertedWith('C9b');
      });
    });
  });

  describe('editFee', function () {
    let module;
    let feeType;
    let feePercentage;

    async function editFee() {
      return await controller.connect(caller).editFee(module, feeType, feePercentage);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      module = basicIssuanceModule.address;
      feeType = BigNumber.from(1);
      feePercentage = ZERO;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(editFee);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
        await controller.addModule(basicIssuanceModule.address);
        await controller.addFee(basicIssuanceModule.address, feeType, BigNumber.from(10));
      });

      shouldRevertWhenNotOwner(editFee);

      it('should emit the EditFee event', async function () {
        await expect(editFee()).emit(controller, 'EditFee').withArgs(module, feeType, feePercentage);
      });

      it('should edit the fees mapping', async function () {
        const result = await controller.getModuleFee(module, feeType);
        expect(result).eq(ZERO);
      });

      it('should revert when the module does not exist', async function () {
        module = userMock.address;
        await expect(editFee()).revertedWith('C10a');
      });

      it('should revert when the feeType does not exist on the module', async function () {
        await expect(editFee()).revertedWith('C10b');
      });
    });
  });

  describe('editFeeRecipient', function () {
    let protocolFeeRecipient;

    async function editFeeRecipient() {
      return await controller.connect(caller).editFeeRecipient(protocolFeeRecipient);
    }

    let snapshotId;
    before(async function () {
      snapshotId = await snapshotBlockchain();
    });

    after(async function () {
      await revertBlockchain(snapshotId);
    });

    beforeEach(async function () {
      protocolFeeRecipient = userMock.address;
      caller = owner;
    });

    context('when not init', async function () {
      shouldRevertWhenNotInit(editFeeRecipient);
    });

    context('when init OK', async function () {
      before(async function () {
        await controller.initialize([], [], [], []);
      });

      shouldRevertWhenNotOwner(editFeeRecipient);

      it('should emit the EditFeeRecipient event', async function () {
        const oldFeeRecipient = await controller.getFeeRecipient();
        await expect(editFeeRecipient()).emit(controller, 'EditFeeRecipient').withArgs(controller.address, oldFeeRecipient, protocolFeeRecipient);
      });

      it('should edit the fee recipient', async function () {
        const result = await controller.getFeeRecipient();
        expect(result).eq(userMock.address);
      });

      it('should revert when the new address is empty', async function () {
        protocolFeeRecipient = ZERO_ADDRESS;
        await expect(editFeeRecipient()).revertedWith('C11');
      });
    });
  });
});
