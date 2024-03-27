// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { ethToWei } = require('../../helpers/unitUtil');
const { preciseMul } = require('../../helpers/mathUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { getTransactionTimestamp } = require('../../helpers/txUtil');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { ZERO_ADDRESS, ZERO, PRECISE_UNIT, ONE_YEAR_IN_SECONDS } = require('../../helpers/constants');
const { getStreamingFee, getPostFeePositionUnits, getStreamingFeeInflationAmount } = require('../../helpers/feeModuleUtil');
const { snapshotBlockchain, revertBlockchain, increaseBlockTime, getLastBlockTimestamp } = require('../../helpers/evmUtil');

describe('contract StreamingFeeModule', () => {
  const [owner, protocolFeeRecipient, feeRecipient, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);

  let rootSnapshotId;
  before(async () => {
    rootSnapshotId = await snapshotBlockchain();
    await systemFixture.initAll();
  });

  after(async () => {
    await revertBlockchain(rootSnapshotId);
  });

  describe('initialize', () => {
    let caller;
    let matrixToken;
    let feeRecipient;
    let maxStreamingFeePercentage;
    let streamingFeePercentage;
    let matrixTokenAddress;
    let feeStateSetting;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      caller = owner;

      feeRecipient = await getRandomAddress();
      maxStreamingFeePercentage = ethToWei(0.1);
      streamingFeePercentage = ethToWei(0.02);

      feeStateSetting = {
        feeRecipient,
        maxStreamingFeePercentage,
        streamingFeePercentage,
        lastStreamingFeeTimestamp: ZERO,
      };
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return systemFixture.streamingFeeModule.connect(caller).initialize(matrixTokenAddress, feeStateSetting);
    }

    it('should enable the Module on the MatrixToken', async () => {
      await initialize();
      const isModuleEnabled = await matrixToken.isInitializedModule(systemFixture.streamingFeeModule.address);
      expect(isModuleEnabled).is.true;
    });

    it('should set all the fields in FeeState correctly', async () => {
      const txTimestamp = await getTransactionTimestamp(initialize());
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixToken.address);

      expect(feeState.lastStreamingFeeTimestamp).eq(txTimestamp);
      expect(feeState.feeRecipient).eq(feeStateSetting.feeRecipient);
      expect(feeState.maxStreamingFeePercentage).eq(feeStateSetting.maxStreamingFeePercentage);
      expect(feeState.streamingFeePercentage).eq(feeStateSetting.streamingFeePercentage);
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when module is in NONE state', async () => {
      await initialize();
      await matrixToken.removeModule(systemFixture.streamingFeeModule.address);
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when module is in INITIALIZED state', async () => {
      await initialize();
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const newToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });

    it('should revert when passed max fee is greater than 100%', async () => {
      feeStateSetting.maxStreamingFeePercentage = ethToWei(1.1);
      await expect(initialize()).revertedWith('SF0b');
    });

    it('should revert when passed fee is greater than max fee', async () => {
      feeStateSetting.streamingFeePercentage = ethToWei(0.11);
      await expect(initialize()).revertedWith('SF0c');
    });

    it('should revert when feeRecipient is zero address', async () => {
      feeStateSetting.feeRecipient = ZERO_ADDRESS;
      await expect(initialize()).revertedWith('SF0a');
    });
  });

  describe('removeModule', () => {
    let matrixToken;
    let module;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );

      const feeRecipient = await getRandomAddress();
      const streamingFeePercentage = ethToWei(0.02);
      const maxStreamingFeePercentage = ethToWei(0.1);

      const feeStateSetting = {
        feeRecipient,
        maxStreamingFeePercentage,
        streamingFeePercentage,
        lastStreamingFeeTimestamp: ZERO,
      };

      await systemFixture.streamingFeeModule.initialize(matrixToken.address, feeStateSetting);

      module = systemFixture.streamingFeeModule.address;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should delete the feeState', async () => {
      await matrixToken.removeModule(module);
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixToken.address);
      expect(feeState.feeRecipient).eq(ZERO_ADDRESS);
      expect(feeState.maxStreamingFeePercentage).eq(ZERO);
      expect(feeState.streamingFeePercentage).eq(ZERO);
      expect(feeState.lastStreamingFeeTimestamp).eq(ZERO);
    });
  });

  describe('getFee', () => {
    let matrixToken;
    let feeStateSetting;
    let matrixTokenAddress;
    let timeFastForward;

    before(async () => {
      feeStateSetting = {
        feeRecipient: feeRecipient.address,
        maxStreamingFeePercentage: ethToWei(0.1),
        streamingFeePercentage: ethToWei(0.02),
        lastStreamingFeeTimestamp: ZERO,
      };
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      await systemFixture.streamingFeeModule.initialize(matrixToken.address, feeStateSetting);
      timeFastForward = ONE_YEAR_IN_SECONDS;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function getFee() {
      await increaseBlockTime(timeFastForward);
      return systemFixture.streamingFeeModule.getFee(matrixTokenAddress);
    }

    it('return the correct fee inflation percentage', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const feeInflation = await getFee();
      const callTimestamp = await getLastBlockTimestamp();
      const expectedFeePercent = await getStreamingFee(systemFixture.streamingFeeModule, matrixTokenAddress, feeState.lastStreamingFeeTimestamp, callTimestamp);
      expect(feeInflation).eq(expectedFeePercent);
    });
  });

  describe('actualizeFee', () => {
    let matrixToken;
    let feeStateSetting;
    let isInitialized = false;
    let protocolFee;
    let matrixTokenAddress;
    let timeFastForward;

    before(async () => {
      feeStateSetting = {
        feeRecipient: feeRecipient.address,
        maxStreamingFeePercentage: ethToWei(0.1),
        streamingFeePercentage: ethToWei(0.02),
        lastStreamingFeeTimestamp: ZERO,
      };
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.streamingFeeModule.address];
      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(0.01)], modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      if (!isInitialized) {
        await systemFixture.streamingFeeModule.initialize(matrixToken.address, feeStateSetting);
      }

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(1));
      await systemFixture.basicIssuanceModule.connect(owner).issue(matrixToken.address, ethToWei(1), owner.address);

      protocolFee = ethToWei(0.15);
      await systemFixture.controller.addFee(systemFixture.streamingFeeModule.address, ZERO, protocolFee);

      timeFastForward = ONE_YEAR_IN_SECONDS;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function actualizeFee() {
      await increaseBlockTime(timeFastForward);
      return systemFixture.streamingFeeModule.actualizeFee(matrixTokenAddress);
    }

    it('mints the correct amount of new MatrixToken to the feeRecipient', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const oldBalance = await matrixToken.balanceOf(feeState.feeRecipient);
      const oldTotalSupply = await matrixToken.totalSupply();
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const newBalance = await matrixToken.balanceOf(feeState.feeRecipient);
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);
      const protocolFeeAmount = preciseMul(feeInflation, protocolFee);
      expect(newBalance.sub(oldBalance)).eq(feeInflation.sub(protocolFeeAmount));
    });

    it('mints the correct amount of new Sets to the protocol feeRecipient', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const oldTotalSupply = await matrixToken.totalSupply();
      const oldBalance = await matrixToken.balanceOf(systemFixture.feeRecipient.address);
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const newBalance = await matrixToken.balanceOf(systemFixture.feeRecipient.address);
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);
      expect(newBalance.sub(oldBalance)).eq(preciseMul(feeInflation, protocolFee));
    });

    it('emits the correct ActualizeFee event', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const oldTotalSupply = await matrixToken.totalSupply();
      const promise = actualizeFee();
      const txnTimestamp = await getTransactionTimestamp(promise);
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);
      const protocolFeeAmount = preciseMul(feeInflation, protocolFee);
      const managerFee = feeInflation.sub(protocolFeeAmount);
      await expect(promise)
        .emit(systemFixture.streamingFeeModule, 'ActualizeFee')
        .withArgs(matrixToken.address, feeRecipient.address, managerFee, systemFixture.feeRecipient.address, protocolFeeAmount);
    });

    it('update totalSupply correctly', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const oldTotalSupply = await matrixToken.totalSupply();
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const newTotalSupply = await matrixToken.totalSupply();
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);
      expect(newTotalSupply.sub(oldTotalSupply)).eq(feeInflation);
    });

    it('sets a new lastStreamingFeeTimestamp', async () => {
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      expect(feeState.lastStreamingFeeTimestamp).eq(txnTimestamp);
    });

    it('updates positionMultiplier correctly', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const newMultiplier = await matrixToken.getPositionMultiplier();
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const expectedNewMultiplier = preciseMul(PRECISE_UNIT, PRECISE_UNIT.sub(expectedFeeInflation));
      expect(newMultiplier).eq(expectedNewMultiplier);
    });

    it('updates position units correctly', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      const oldPositions = await matrixToken.getPositions();
      const txnTimestamp = await getTransactionTimestamp(actualizeFee());
      const newPositions = await matrixToken.getPositions();
      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp
      );
      const expectedNewUnits = getPostFeePositionUnits([oldPositions[0].unit], expectedFeeInflation);
      expect(newPositions[0].unit).eq(expectedNewUnits[0]);
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = newToken.address;
      await expect(actualizeFee()).revertedWith('M3');
    });

    describe('case 1.1: when a position is negative', () => {
      beforeEach(async () => {
        await systemFixture.controller.addModule(owner.address);
        await matrixToken.addModule(owner.address);
        await matrixToken.initializeModule();

        await matrixToken.addComponent(systemFixture.usdc.address);
        await matrixToken.addExternalPositionModule(systemFixture.usdc.address, owner.address);
        await matrixToken.editExternalPositionUnit(systemFixture.usdc.address, owner.address, ethToWei(0.01).mul(-1));
      });

      it('case 1.1: updates positionMultiplier correctly', async () => {
        const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
        const txnTimestamp = await getTransactionTimestamp(actualizeFee());
        const expectedFeeInflation = await getStreamingFee(
          systemFixture.streamingFeeModule,
          matrixTokenAddress,
          feeState.lastStreamingFeeTimestamp,
          txnTimestamp
        );
        const expectedNewMultiplier = preciseMul(PRECISE_UNIT, PRECISE_UNIT.sub(expectedFeeInflation));
        const newMultiplier = await matrixToken.getPositionMultiplier();
        expect(newMultiplier).eq(expectedNewMultiplier);
      });

      it('case 1.1: update position units correctly', async () => {
        const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
        const oldPositions = await matrixToken.getPositions();
        const txnTimestamp = await getTransactionTimestamp(actualizeFee());
        const newPositions = await matrixToken.getPositions();
        const expectedFeeInflation = await getStreamingFee(
          systemFixture.streamingFeeModule,
          matrixTokenAddress,
          feeState.lastStreamingFeeTimestamp,
          txnTimestamp
        );
        const expectedNewUnits = getPostFeePositionUnits([oldPositions[0].unit, oldPositions[1].unit], expectedFeeInflation);

        expect(newPositions[0].unit).eq(expectedNewUnits[0]);
        expect(newPositions[1].unit).eq(expectedNewUnits[1]);
      });
    });

    describe('case 1.2: when protocolFee is 0', () => {
      beforeEach(async () => {
        await systemFixture.controller.editFee(systemFixture.streamingFeeModule.address, ZERO, ZERO);
      });

      it('case 1.2: mints the correct amount of new Sets to the feeRecipient', async () => {
        const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
        const oldTotalSupply = await matrixToken.totalSupply();
        const oldBalance = await matrixToken.balanceOf(feeState.feeRecipient);
        const txnTimestamp = await getTransactionTimestamp(actualizeFee());
        const newBalance = await matrixToken.balanceOf(feeState.feeRecipient);
        const expectedFeeInflation = await getStreamingFee(
          systemFixture.streamingFeeModule,
          matrixTokenAddress,
          feeState.lastStreamingFeeTimestamp,
          txnTimestamp
        );
        const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);
        expect(newBalance.sub(oldBalance)).eq(feeInflation);
      });

      it('case 1.2: mints no MatrixToken to the protocol feeRecipient', async () => {
        const oldBalance = await matrixToken.balanceOf(systemFixture.feeRecipient.address);
        await actualizeFee();
        const newBalance = await matrixToken.balanceOf(systemFixture.feeRecipient.address);
        expect(newBalance).eq(oldBalance);
      });
    });

    describe('case 1.3: when streamingFee is 0', () => {
      beforeEach(async () => {
        await systemFixture.streamingFeeModule.updateStreamingFee(matrixTokenAddress, ZERO);
      });

      it('case 1.3: should update the last timestamp', async () => {
        const txnTimestamp = await getTransactionTimestamp(actualizeFee());
        const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
        expect(feeState.lastStreamingFeeTimestamp).eq(txnTimestamp);
      });

      it('case 1.3: emits the correct ActualizeFee event', async () => {
        const promise = actualizeFee();
        await expect(promise)
          .emit(systemFixture.streamingFeeModule, 'ActualizeFee')
          .withArgs(matrixToken.address, feeRecipient.address, ZERO, systemFixture.feeRecipient.address, ZERO);
      });
    });

    describe('case 1.4: when module is not initialized', () => {
      before(async () => {
        isInitialized = true;
      });

      after(async () => {
        isInitialized = false;
      });

      it('case 1.4: should revert', async () => {
        await expect(actualizeFee()).revertedWith('M3');
      });
    });
  });

  describe('updateStreamingFee', () => {
    let matrixToken;
    let feeStateSetting;
    let matrixTokenAddress;
    let newFee;
    let timeFastForward;
    let caller;

    let isInitialized = false;

    before(async () => {
      feeStateSetting = {
        feeRecipient: feeRecipient.address,
        maxStreamingFeePercentage: ethToWei(0.1),
        streamingFeePercentage: ethToWei(0.02),
        lastStreamingFeeTimestamp: ZERO,
      };
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.streamingFeeModule.address];
      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(0.01)], modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      if (!isInitialized) {
        await systemFixture.streamingFeeModule.initialize(matrixToken.address, feeStateSetting);
      }
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      await systemFixture.weth.approve(systemFixture.basicIssuanceModule.address, ethToWei(1));
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

      caller = owner;
      newFee = ethToWei(0.03);
      timeFastForward = ONE_YEAR_IN_SECONDS;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function updateStreamingFee() {
      await increaseBlockTime(timeFastForward);
      return systemFixture.streamingFeeModule.connect(caller).updateStreamingFee(matrixTokenAddress, newFee);
    }

    it('sets the new fee percentage', async () => {
      await updateStreamingFee();
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      expect(feeState.streamingFeePercentage).eq(newFee);
    });

    it('accrues fees to the feeRecipient at old fee rate', async () => {
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);

      const oldTotalSupply = await matrixToken.totalSupply();
      const oldBalance = await matrixToken.balanceOf(feeState.feeRecipient);
      const txnTimestamp = await getTransactionTimestamp(updateStreamingFee());
      const newBalance = await matrixToken.balanceOf(feeState.feeRecipient);

      const expectedFeeInflation = await getStreamingFee(
        systemFixture.streamingFeeModule,
        matrixTokenAddress,
        feeState.lastStreamingFeeTimestamp,
        txnTimestamp,
        feeState.streamingFeePercentage
      );
      const feeInflation = getStreamingFeeInflationAmount(expectedFeeInflation, oldTotalSupply);

      expect(newBalance.sub(oldBalance)).eq(feeInflation);
    });

    it('emits the UpdateStreamingFee event', async () => {
      await expect(updateStreamingFee())
        .emit(systemFixture.streamingFeeModule, 'UpdateStreamingFee')
        .withArgs(matrixTokenAddress, feeStateSetting.streamingFeePercentage, newFee);
    });

    it('sets the new fee percentage when the streaming fee is initially 0', async () => {
      feeStateSetting.streamingFeePercentage = ZERO;
      await updateStreamingFee();
      feeStateSetting.streamingFeePercentage = ethToWei(0.02);
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      expect(feeState.streamingFeePercentage).eq(newFee);
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = newToken.address;
      await expect(updateStreamingFee()).revertedWith('M3');
    });

    it('should revert when passed fee is greater than max fee', async () => {
      newFee = ethToWei(0.11);
      await expect(updateStreamingFee()).revertedWith('SF1');
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
      await expect(updateStreamingFee()).revertedWith('M2');
    });

    describe('when the existing fee is 0', () => {
      before(async () => {
        isInitialized = true;
      });

      after(async () => {
        isInitialized = false;
      });

      it('should revert', async () => {
        await expect(updateStreamingFee()).revertedWith('M3');
      });
    });
  });

  describe('updateFeeRecipient', () => {
    let matrixToken;
    let feeStateSetting;
    let isInitialized = false;

    let matrixTokenAddress;
    let newFeeRecipient;
    let caller;

    before(async () => {
      feeStateSetting = {
        feeRecipient: feeRecipient.address,
        maxStreamingFeePercentage: ethToWei(0.1),
        streamingFeePercentage: ethToWei(0.02),
        lastStreamingFeeTimestamp: ZERO,
      };
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      const modules = [systemFixture.basicIssuanceModule.address, systemFixture.streamingFeeModule.address];
      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(0.01)], modules, owner.address);
      matrixTokenAddress = matrixToken.address;

      if (!isInitialized) {
        await systemFixture.streamingFeeModule.initialize(matrixToken.address, feeStateSetting);
      }

      caller = owner;
      newFeeRecipient = owner.address;
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function updateFeeRecipient() {
      return systemFixture.streamingFeeModule.connect(caller).updateFeeRecipient(matrixTokenAddress, newFeeRecipient);
    }

    it('sets the fee recipient', async () => {
      await updateFeeRecipient();
      const feeState = await systemFixture.streamingFeeModule.getFeeState(matrixTokenAddress);
      expect(feeState.feeRecipient).eq(newFeeRecipient);
    });

    it('emits the UpdateFeeRecipient event', async () => {
      await expect(updateFeeRecipient())
        .emit(systemFixture.streamingFeeModule, 'UpdateFeeRecipient')
        .withArgs(matrixTokenAddress, feeRecipient.address, newFeeRecipient);
    });

    it('should revert when feeRecipient is zero address', async () => {
      newFeeRecipient = ZERO_ADDRESS;
      await expect(updateFeeRecipient()).revertedWith('SF2');
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = randomAccount;
      await expect(updateFeeRecipient()).revertedWith('M2');
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [systemFixture.streamingFeeModule.address],
        owner.address
      );
      matrixTokenAddress = newToken.address;
      await expect(updateFeeRecipient()).revertedWith('M3');
    });

    describe('should revert when module is not initialized', () => {
      before(async () => {
        isInitialized = true;
      });

      after(async () => {
        isInitialized = false;
      });

      it('should revert', async () => {
        await expect(updateFeeRecipient()).revertedWith('M3');
      });
    });
  });
});
