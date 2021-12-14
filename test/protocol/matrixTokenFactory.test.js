// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { getSigners, getRandomAddress } = require('../helpers/accountUtil');
const { getCreatedMatrixTokenAddress } = require('../helpers/protocolUtil');
const { ZERO_ADDRESS, ZERO, PRECISE_UNIT } = require('../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('contract MatrixTokenFactory', async () => {
  const [owner, feeRecipient] = getSigners();

  let controller;
  let factoryMock;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    controller = await deployContract('Controller', [feeRecipient.address], owner);
    factoryMock = await deployContract('MatrixTokenFactory', [controller.address], owner);

    await controller.initialize([factoryMock.address], [], [], []);
  });

  after(async () => {
    revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    it('should have the correct controller', async () => {
      const result = await factoryMock.getController();
      expect(result).eq(controller.address);
    });
  });

  describe('create', async () => {
    let firstComponent;
    let secondComponent;
    let firstModule;
    let secondModule;

    let components;
    let units;
    let modules;
    let tokenManager;
    let tokenName;
    let tokenSymbol;

    async function create() {
      return await factoryMock.create(components, units, modules, tokenManager, tokenName, tokenSymbol);
    }

    before(async () => {
      firstComponent = await deployContract('Erc20Mock', ['First Standard Token', 'STM', 18], owner);
      secondComponent = await deployContract('Erc20Mock', ['Second Standard Token', 'STM', 18], owner);
      firstModule = await getRandomAddress();
      secondModule = await getRandomAddress();

      await controller.addModule(firstModule);
      await controller.addModule(secondModule);

      tokenName = 'TestMatrixToken';
      tokenSymbol = 'MAT';
    });

    beforeEach(async () => {
      components = [firstComponent.address, secondComponent.address];
      units = [PRECISE_UNIT, PRECISE_UNIT];
      modules = [firstModule, secondModule];
      tokenManager = await getRandomAddress();
    });

    it('should revert when no modules are passed in', async () => {
      modules = [];
      await expect(create()).revertedWith('F0b');
    });

    it('should revert when the manager is a null address', async () => {
      tokenManager = ZERO_ADDRESS;
      await expect(create()).revertedWith('F0a');
    });

    it('should revert when no components are passed in', async () => {
      components = [];
      await expect(create()).revertedWith('F0c');
    });

    it('should revert when the component and units arrays are not the same length', async () => {
      units = [PRECISE_UNIT];
      await expect(create()).revertedWith('F0d');
    });

    it('should revert when no components have a duplicate', async () => {
      components = [firstComponent.address, firstComponent.address];
      await expect(create()).revertedWith('F0e');
    });

    it('should revert when a component is a null address', async () => {
      components = [firstComponent.address, ZERO_ADDRESS];
      await expect(create()).revertedWith('F0f');
    });

    it('should revert when a unit is 0', async () => {
      units = [PRECISE_UNIT, ZERO];
      await expect(create()).revertedWith('F0g');
    });

    it('should revert when a module is not approved by the Controller', async () => {
      const invalidModuleAddress = await getRandomAddress();
      modules = [firstModule, invalidModuleAddress];
      await expect(create()).revertedWith('F0h');
    });

    it('should properly create the MatrixToken', async () => {
      const receipt = await create();
      const result = await getCreatedMatrixTokenAddress(receipt.hash);
      expect(result).is.properAddress;
    });

    it('should emit the correct CreateMatrixToken event', async () => {
      const promise = create();
      const matrixAddress = await getCreatedMatrixTokenAddress((await promise).hash);
      await expect(promise).emit(factoryMock, 'CreateMatrixToken').withArgs(matrixAddress, tokenManager, tokenName, tokenSymbol);
    });

    it('should enable the MatrixToken on the controller', async () => {
      const receipt = await create();
      const token = await getCreatedMatrixTokenAddress(receipt.hash);
      const result = await controller.isMatrix(token);
      expect(result).is.true;
    });
  });
});
