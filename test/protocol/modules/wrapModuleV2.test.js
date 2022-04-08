// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../../helpers/unitUtil');
const { preciseMul } = require('../../helpers/mathUtil');
const { deployContract } = require('../../helpers/deploy');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { getSigners, getRandomAddress, getEthBalance } = require('../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');
const { ZERO, ZERO_ADDRESS, ZERO_BYTES } = require('../../helpers/constants');

describe('contract WrapModuleV2', async () => {
  const [owner, protocolFeeRecipient, randomAccount] = await getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const wrapV2AdapterName = 'WRAP_V2_ADAPTER';

  let wrapV2Module;
  let wrapV2Adapter; // WrapV2AdapterMock

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();

    wrapV2Module = await deployContract('WrapModuleV2', [systemFixture.controller.address, systemFixture.weth.address, 'WrapModuleV2'], owner);
    await systemFixture.controller.addModule(wrapV2Module.address);

    wrapV2Adapter = await deployContract('WrapV2AdapterMock', [], owner);
    await systemFixture.integrationRegistry.addIntegration(wrapV2Module.address, wrapV2AdapterName, wrapV2Adapter.address);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    it('should set the correct controller', async () => {
      expect(await wrapV2Module.getController()).eq(systemFixture.controller.address);
    });

    it('should set the correct weth contract', async () => {
      expect(await wrapV2Module.getWeth()).eq(systemFixture.weth.address);
    });
  });

  describe('initialize', async () => {
    let caller;
    let matrixToken;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [wrapV2Module.address], owner);
      matrixTokenAddress = matrixToken.address;
      caller = owner;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return wrapV2Module.connect(caller).initialize(matrixTokenAddress);
    }

    it('should enable the Module on the MatrixToken', async () => {
      await initialize();
      expect(await matrixToken.isInitializedModule(wrapV2Module.address)).is.true;
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when MatrixToken is not in pending state', async () => {
      const newModule = await getRandomAddress();
      await systemFixture.controller.addModule(newModule);
      const wrapModuleNotPendingSetToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [newModule], owner);
      matrixTokenAddress = wrapModuleNotPendingSetToken.address;
      await expect(initialize()).revertedWith('WMb0b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [wrapV2Module.address], owner);
      matrixTokenAddress = nonEnabledToken.address;
      await expect(initialize()).revertedWith('WMb0a');
    });
  });

  describe('removeModule', async () => {
    let caller;
    let module;
    let matrixToken;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [wrapV2Module.address], owner);
      await wrapV2Module.initialize(matrixToken.address);
      module = wrapV2Module.address;
      caller = owner;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function removeModule() {
      return matrixToken.connect(caller).removeModule(module);
    }

    it('should properly remove the module', async () => {
      await removeModule();
      expect(await matrixToken.isInitializedModule(module)).is.false;
    });
  });

  context('when a MatrixToken has been deployed and issued', async () => {
    const matrixTokensIssued = ethToWei(10);

    let matrixToken;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    before(async () => {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
        owner
      );

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
      await wrapV2Module.initialize(matrixToken.address);

      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, matrixTokensIssued);
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, matrixTokensIssued, owner.address);
    });

    describe('wrap', async () => {
      let caller;
      let wrapData;
      let wrappedToken;
      let underlyingUnits;
      let integrationName;
      let underlyingToken;
      let matrixTokenAddress;

      beforeEach(async () => {
        caller = owner;
        wrapData = ZERO_BYTES;
        underlyingUnits = ethToWei(1);
        integrationName = wrapV2AdapterName;
        wrappedToken = wrapV2Adapter.address;
        matrixTokenAddress = matrixToken.address;
        underlyingToken = systemFixture.weth.address;
      });

      async function wrap() {
        return wrapV2Module.connect(caller).wrap(matrixTokenAddress, underlyingToken, wrappedToken, underlyingUnits, integrationName, wrapData);
      }

      it('should mint the correct wrapped asset to the MatrixToken', async () => {
        const oldWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        await wrap();
        const newWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        expect(newWrappedBalance.sub(oldWrappedBalance)).eq(matrixTokensIssued);
      });

      it('should reduce the correct quantity of the underlying quantity', async () => {
        const oldUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        await wrap();
        const newUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        expect(oldUnderlyingBalance.sub(newUnderlyingBalance)).eq(matrixTokensIssued);
      });

      it('remove the underlying position and replace with the wrapped token position', async () => {
        await wrap();

        const positions = await matrixToken.getPositions();
        expect(positions.length).eq(1);

        const receivedWrappedTokenPosition = positions[0];
        expect(receivedWrappedTokenPosition.component).eq(wrappedToken);
        expect(receivedWrappedTokenPosition.unit).eq(underlyingUnits);
      });

      it('emits the correct WrapComponent event', async () => {
        await expect(wrap())
          .to.emit(wrapV2Module, 'WrapComponent')
          .withArgs(matrixToken.address, underlyingToken, wrappedToken, preciseMul(underlyingUnits, matrixTokensIssued), matrixTokensIssued, integrationName);
      });

      it('should revert when the integration ID is invalid', async () => {
        integrationName = 'INVALID_NAME';
        await expect(wrap()).revertedWith('M0');
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(wrap()).revertedWith('M1a');
      });

      it('should revert when the MatrixToken has not initialized the module', async () => {
        const newMatrixToken = await systemFixture.createMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
          owner
        );

        matrixTokenAddress = newMatrixToken.address;
        await expect(wrap()).revertedWith('M1b');
      });

      it('should revert when the subjectComponent is not a Default Position', async () => {
        underlyingToken = await getRandomAddress();
        await expect(wrap()).revertedWith('WMb1b');
      });

      it('should revert when the units is greater than on the position', async () => {
        underlyingUnits = ethToWei(100);
        await expect(wrap()).revertedWith('WMb1c');
      });

      it('should revert when the underlying units is 0', async () => {
        underlyingUnits = ZERO;
        await expect(wrap()).revertedWith('WMb1a');
      });
    });

    describe('wrapWithEther', async () => {
      let caller;
      let wrapData;
      let wrappedToken;
      let underlyingUnits;
      let integrationName;
      let matrixTokenAddress;

      beforeEach(async () => {
        caller = owner;
        wrapData = ZERO_BYTES;
        underlyingUnits = ethToWei(1);
        integrationName = wrapV2AdapterName;
        wrappedToken = wrapV2Adapter.address;
        matrixTokenAddress = matrixToken.address;
      });

      async function wrapWithEther() {
        return wrapV2Module.connect(caller).wrapWithEther(matrixTokenAddress, wrappedToken, underlyingUnits, integrationName, wrapData);
      }

      it('should mint the correct wrapped asset to the MatrixToken', async () => {
        const oldWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        await wrapWithEther();
        const newWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        expect(newWrappedBalance.sub(oldWrappedBalance)).eq(matrixTokensIssued);
      });

      it('should reduce the correct quantity of WETH', async () => {
        const oldUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        await wrapWithEther();
        const newUnderlyingBalance = await systemFixture.weth.balanceOf(matrixToken.address);
        expect(oldUnderlyingBalance.sub(newUnderlyingBalance)).eq(matrixTokensIssued);
      });

      it('should send the correct quantity of ETH to the external protocol', async () => {
        const oldEthBalance = await getEthBalance(wrapV2Adapter.address);
        await wrapWithEther();
        const newEthBalance = await getEthBalance(wrapV2Adapter.address);
        expect(newEthBalance.sub(oldEthBalance)).eq(preciseMul(underlyingUnits, matrixTokensIssued));
      });

      it('removes the underlying position and replace with the wrapped token position', async () => {
        await wrapWithEther();

        const positions = await matrixToken.getPositions();
        expect(positions.length).eq(1);

        const receivedWrappedTokenPosition = positions[0];
        expect(receivedWrappedTokenPosition.component).eq(wrappedToken);
        expect(receivedWrappedTokenPosition.unit).eq(underlyingUnits);
      });

      it('emits the correct WrapComponent event', async () => {
        await expect(wrapWithEther())
          .to.emit(wrapV2Module, 'WrapComponent')
          .withArgs(
            matrixToken.address,
            systemFixture.weth.address,
            wrappedToken,
            preciseMul(underlyingUnits, matrixTokensIssued),
            matrixTokensIssued,
            integrationName
          );
      });

      it('should revert when the integration ID is invalid', async () => {
        integrationName = 'INVALID_NAME';
        await expect(wrapWithEther()).revertedWith('M0');
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(wrapWithEther()).revertedWith('M1a');
      });

      it('should revert when the MatrixToken has not initialized the module', async () => {
        const newMatrixToken = await systemFixture.createMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
          owner
        );
        matrixTokenAddress = newMatrixToken.address;

        await expect(wrapWithEther()).revertedWith('M1b');
      });

      it('should revert when WETH is not a Default Position', async () => {
        const nonWethMatrixToken = await systemFixture.createMatrixToken(
          [systemFixture.wbtc.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
          owner
        );
        matrixTokenAddress = nonWethMatrixToken.address;

        await systemFixture.basicIssuanceModule.initialize(nonWethMatrixToken.address, ZERO_ADDRESS);
        await wrapV2Module.initialize(nonWethMatrixToken.address);

        await expect(wrapWithEther()).revertedWith('WMb1b');
      });

      it('should revert when the units is greater than on the position', async () => {
        underlyingUnits = ethToWei(100);
        await expect(wrapWithEther()).revertedWith('WMb1c');
      });

      it('should revert when the underlying units is 0', async () => {
        underlyingUnits = ZERO;
        await expect(wrapWithEther()).revertedWith('WMb1a');
      });
    });

    describe('unwrap', async () => {
      let caller;
      let unwrapData;
      let wrappedToken;
      let underlyingToken;
      let wrappedQuantity;
      let integrationName;
      let wrappedTokenUnits;
      let matrixTokenAddress;

      beforeEach(async () => {
        caller = owner;
        unwrapData = ZERO_BYTES;
        wrappedQuantity = ethToWei(1);
        wrappedTokenUnits = ethToWei(0.5);
        integrationName = wrapV2AdapterName;
        wrappedToken = wrapV2Adapter.address;
        matrixTokenAddress = matrixToken.address;
        underlyingToken = systemFixture.weth.address;

        await wrapV2Module.wrap(matrixTokenAddress, underlyingToken, wrappedToken, wrappedQuantity, integrationName, ZERO_BYTES);
      });

      async function unwrap() {
        return wrapV2Module.connect(caller).unwrap(matrixTokenAddress, underlyingToken, wrappedToken, wrappedTokenUnits, integrationName, unwrapData);
      }

      it('should burn the correct wrapped asset to the MatrixToken', async () => {
        const oldWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        await unwrap();
        const newWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        const expectedTokenBalance = preciseMul(matrixTokensIssued, wrappedQuantity.sub(wrappedTokenUnits));
        expect(oldWrappedBalance.sub(newWrappedBalance)).eq(expectedTokenBalance);
      });

      it('should properly update the underlying and wrapped token units', async () => {
        await unwrap();

        const positions = await matrixToken.getPositions();
        expect(positions.length).eq(2);

        const [receivedWrappedPosition, receivedUnderlyingPosition] = positions;

        expect(receivedWrappedPosition.component).eq(wrappedToken);
        expect(receivedWrappedPosition.unit).eq(ethToWei(0.5));

        expect(receivedUnderlyingPosition.component).eq(underlyingToken);
        expect(receivedUnderlyingPosition.unit).eq(ethToWei(0.5));
      });

      it('emits the correct UnwrapComponent event', async () => {
        const underlyingQuantity = preciseMul(wrappedTokenUnits, matrixTokensIssued);
        const wrapQuantity = preciseMul(matrixTokensIssued, wrappedQuantity.sub(wrappedTokenUnits));
        await expect(unwrap())
          .to.emit(wrapV2Module, 'UnwrapComponent')
          .withArgs(matrixToken.address, underlyingToken, wrappedToken, underlyingQuantity, wrapQuantity, integrationName);
      });

      it('should revert when the integration ID is invalid', async () => {
        integrationName = 'INVALID_NAME';
        await expect(unwrap()).revertedWith('M0');
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(unwrap()).revertedWith('M1a');
      });

      it('should revert when the MatrixToken has not initialized the module', async () => {
        const newMatrixToken = await systemFixture.createMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
          owner
        );
        matrixTokenAddress = newMatrixToken.address;

        await expect(unwrap()).revertedWith('M1b');
      });

      it('should revert when the component is not a Default Position', async () => {
        wrappedToken = await getRandomAddress();
        await expect(unwrap()).revertedWith('WMb1b');
      });

      it('should revert when the units is greater than on the position', async () => {
        wrappedTokenUnits = ethToWei(100);
        await expect(unwrap()).revertedWith('WMb1c');
      });

      it('should revert when the underlying units is 0', async () => {
        wrappedTokenUnits = ZERO;
        await expect(unwrap()).revertedWith('WMb1a');
      });
    });

    describe('unwrapWithEther', async () => {
      let caller;
      let unwrapData;
      let wrappedToken;
      let wrappedQuantity;
      let integrationName;
      let wrappedTokenUnits;
      let matrixTokenAddress;

      beforeEach(async () => {
        caller = owner;
        unwrapData = ZERO_BYTES;
        wrappedQuantity = ethToWei(1);
        wrappedTokenUnits = ethToWei(0.5);
        integrationName = wrapV2AdapterName;
        wrappedToken = wrapV2Adapter.address;
        matrixTokenAddress = matrixToken.address;

        await wrapV2Module.wrapWithEther(matrixTokenAddress, wrappedToken, wrappedQuantity, integrationName, ZERO_BYTES);
      });

      async function unwrapWithEther() {
        return wrapV2Module.connect(caller).unwrapWithEther(matrixTokenAddress, wrappedToken, wrappedTokenUnits, integrationName, unwrapData);
      }

      it('should burn the correct wrapped asset to the MatrixToken', async () => {
        const oldWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        await unwrapWithEther();
        const newWrappedBalance = await wrapV2Adapter.balanceOf(matrixToken.address);
        const expectedTokenBalance = preciseMul(matrixTokensIssued, wrappedQuantity.sub(wrappedTokenUnits));
        expect(oldWrappedBalance.sub(newWrappedBalance)).eq(expectedTokenBalance);
      });

      it('should properly update the underlying and wrapped token units', async () => {
        await unwrapWithEther();

        const positions = await matrixToken.getPositions();
        expect(positions.length).eq(2);

        const [receivedWrappedPosition, receivedUnderlyingPosition] = positions;

        expect(receivedWrappedPosition.component).eq(wrappedToken);
        expect(receivedWrappedPosition.unit).eq(ethToWei(0.5));

        expect(receivedUnderlyingPosition.component).eq(systemFixture.weth.address);
        expect(receivedUnderlyingPosition.unit).eq(ethToWei(0.5));
      });

      it('should have sent the correct quantity of ETH to the MatrixToken', async () => {
        const oldEthBalance = await getEthBalance(wrapV2Adapter.address);
        await unwrapWithEther();
        const newEthBalance = await getEthBalance(wrapV2Adapter.address);
        expect(oldEthBalance.sub(newEthBalance)).eq(preciseMul(wrappedTokenUnits, matrixTokensIssued));
      });

      it('emits the correct UnwrapComponent event', async () => {
        const underlyingQuantity = preciseMul(wrappedTokenUnits, matrixTokensIssued);
        const wrapQuantity = preciseMul(matrixTokensIssued, wrappedQuantity.sub(wrappedTokenUnits));

        await expect(unwrapWithEther())
          .to.emit(wrapV2Module, 'UnwrapComponent')
          .withArgs(matrixToken.address, systemFixture.weth.address, wrappedToken, underlyingQuantity, wrapQuantity, integrationName);
      });

      it('should revert when the integration ID is invalid', async () => {
        integrationName = 'INVALID_NAME';
        await expect(unwrapWithEther()).revertedWith('M0');
      });

      it('should revert when the caller is not the manager', async () => {
        caller = randomAccount;
        await expect(unwrapWithEther()).revertedWith('M1a');
      });

      it('should revert when the MatrixToken has not initialized the module', async () => {
        const newMatrixToken = await systemFixture.createMatrixToken(
          [systemFixture.weth.address],
          [ethToWei(1)],
          [systemFixture.basicIssuanceModule.address, wrapV2Module.address],
          owner
        );
        matrixTokenAddress = newMatrixToken.address;

        await expect(unwrapWithEther()).revertedWith('M1b');
      });

      it('should revert when the subjectComponent is not a Default Position', async () => {
        wrappedToken = await getRandomAddress();
        await expect(unwrapWithEther()).revertedWith('WMb1b');
      });

      it('should revert when the units is greater than on the position', async () => {
        wrappedTokenUnits = ethToWei(100);
        await expect(unwrapWithEther()).revertedWith('WMb1c');
      });

      it('should revert when the underlying units is 0', async () => {
        wrappedTokenUnits = ZERO;
        await expect(unwrapWithEther()).revertedWith('WMb1a');
      });
    });
  });
});
