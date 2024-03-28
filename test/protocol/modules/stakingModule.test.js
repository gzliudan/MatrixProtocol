// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../helpers/deploy');
const { getSigners } = require('../../helpers/accountUtil');
const { hashAdapterName } = require('../../helpers/adapterUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { ZERO, ZERO_ADDRESS, ZERO_HASH, EMPTY_BYTES } = require('../../helpers/constants');
const { ethToWei, btcToWei } = require('../../helpers/unitUtil');
const { preciseMul } = require('../../helpers/mathUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract StakingModule', async function () {
  const [owner, protocolFeeRecipient, dummyIssuanceModule, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const STAKE_NAME1 = 'WETH_STAKER1';
  const STAKE_NAME2 = 'WETH_STAKER2';

  let matrixToken;
  let stakingModule;
  let stakingAdapterMock1; // StakingAdapterMock
  let stakingAdapterMock2; // StakingAdapterMock

  let rootSnapshotId;
  before(async function () {
    rootSnapshotId = await snapshotBlockchain();

    await systemFixture.initAll();

    stakingModule = await deployContract('StakingModule', [systemFixture.controller.address, 'StakingModule'], owner);
    await systemFixture.controller.addModule(stakingModule.address);
    await systemFixture.controller.addModule(dummyIssuanceModule.address);

    stakingAdapterMock1 = await deployContract('StakingAdapterMock', [systemFixture.weth.address], owner);
    stakingAdapterMock2 = await deployContract('StakingAdapterMock', [systemFixture.weth.address], owner);

    await systemFixture.integrationRegistry.addIntegration(stakingModule.address, STAKE_NAME1, stakingAdapterMock1.address);
    await systemFixture.integrationRegistry.addIntegration(stakingModule.address, STAKE_NAME2, stakingAdapterMock2.address);

    matrixToken = await systemFixture.createMatrixToken(
      [systemFixture.weth.address, systemFixture.wbtc.address],
      [ethToWei(1), btcToWei(1)],
      [systemFixture.basicIssuanceModule.address, stakingModule.address, dummyIssuanceModule.address],
      owner
    );
    await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
    await matrixToken.connect(dummyIssuanceModule).initializeModule();
  });

  after(async function () {
    await revertBlockchain(rootSnapshotId);
  });

  describe('initialize', function () {
    let caller;
    let matrixToken;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.wbtc.address], [ethToWei(1)], [stakingModule.address], owner);
      matrixTokenAddress = matrixToken.address;
      caller = owner;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return stakingModule.connect(caller).initialize(matrixTokenAddress);
    }

    it('should enable the Module on the MatrixToken', async function () {
      await initialize();
      expect(await matrixToken.isInitializedModule(stakingModule.address)).is.true;
    });

    it('should revert when the caller is not the MatrixToken manager', async function () {
      caller = randomAccount;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when the module is not pending', async function () {
      await initialize();
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async function () {
      const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.dai.address], [ethToWei(1)], [stakingModule.address], owner);
      matrixTokenAddress = nonEnabledToken.address;
      await expect(initialize()).revertedWith('M5a');
    });
  });

  describe('removeModule', function () {
    let module;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      module = stakingModule.address;
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(2), owner.address);
      await stakingModule.initialize(matrixToken.address);
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function removeModule() {
      return matrixToken.removeModule(module);
    }

    it('should remove the module from the MatrixToken', async function () {
      await removeModule();
      const modules = await matrixToken.getModules();
      expect(modules).not.contain(module);
    });

    it('should transfer the staked tokens to the staking contract when the there is an open external position', async function () {
      await stakingModule.stake(matrixToken.address, stakingAdapterMock1.address, systemFixture.weth.address, STAKE_NAME1, ethToWei(0.5));
      await expect(removeModule()).revertedWith('SM2');
    });
  });

  describe('stake', function () {
    const issuedSupply = ethToWei(2);

    let caller;
    let component;
    let adapterName;
    let stakeContract;
    let notInitialized;
    let matrixTokenAddress;
    let componentPositionUnits;

    before(async function () {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      if (notInitialized) {
        await stakingModule.initialize(matrixToken.address);
      }

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, issuedSupply, owner.address);

      caller = owner;
      adapterName = STAKE_NAME1;
      componentPositionUnits = ethToWei(0.5);
      component = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;
      stakeContract = stakingAdapterMock1.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function stake() {
      return stakingModule.connect(caller).stake(matrixTokenAddress, stakeContract, component, adapterName, componentPositionUnits);
    }

    it('should transfer the staked tokens to the staking contract', async function () {
      const oldTokenBalance = await systemFixture.weth.balanceOf(stakeContract);
      await stake();
      const newTokenBalance = await systemFixture.weth.balanceOf(stakeContract);
      const expectedTokensStaked = preciseMul(issuedSupply, componentPositionUnits);
      expect(newTokenBalance.sub(oldTokenBalance)).eq(expectedTokensStaked);
    });

    it('should update the Default units on the MatrixToken correctly', async function () {
      const oldPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
      await stake();
      const newPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
      expect(oldPositionUnit.sub(newPositionUnit)).eq(componentPositionUnits);
    });

    it('should update the External units and state on the MatrixToken correctly', async function () {
      const oldPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
      await stake();
      const newPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);

      const externalModules = await matrixToken.getExternalPositionModules(component);
      const data = await matrixToken.getExternalPositionData(component, stakingModule.address);

      expect(newPositionUnit.sub(oldPositionUnit)).eq(componentPositionUnits);
      expect(externalModules.length).eq(1);
      expect(externalModules[0]).eq(stakingModule.address);
      expect(data).eq(EMPTY_BYTES);
    });

    it('should create the correct ComponentPosition struct on the StakingModule', async function () {
      await stake();
      const stakingContracts = await stakingModule.getStakingContracts(matrixTokenAddress, component);
      const position = await stakingModule.getStakingPosition(matrixTokenAddress, component, stakeContract);

      expect(stakingContracts.length).eq(1);
      expect(stakingContracts[0]).eq(stakeContract);
      expect(position.componentPositionUnits).eq(componentPositionUnits);
      expect(position.adapterHash).eq(hashAdapterName(STAKE_NAME1));
    });

    it('should emit the correct StakeComponent event', async function () {
      await expect(stake())
        .emit(stakingModule, 'StakeComponent')
        .withArgs(matrixTokenAddress, component, stakeContract, componentPositionUnits, stakingAdapterMock1.address);
    });

    it('should emit the correct StakeComponent event when trying to stake more tokens than available in Default state', async function () {
      componentPositionUnits = ethToWei(1.1);
      await expect(stake()).revertedWith('SM0');
    });

    it('should revert when passed adapterName is not valid', async function () {
      adapterName = 'invalid_adapter';
      await expect(stake()).revertedWith('M0');
    });

    it('should revert when caller is not manager', async function () {
      caller = randomAccount;
      await expect(stake()).revertedWith('M1a');
    });

    it('should revert when MatrixToken is not valid', async function () {
      const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [stakingModule.address], owner);
      matrixTokenAddress = nonEnabledToken.address;
      await expect(stake()).revertedWith('M1b');
    });

    describe('when the position is being added to', function () {
      beforeEach(async function () {
        await stake();
      });

      it('should transfer the staked tokens to the staking contract', async function () {
        const oldTokenBalance = await systemFixture.weth.balanceOf(stakeContract);
        await stake();
        const newTokenBalance = await systemFixture.weth.balanceOf(stakeContract);
        const expectedTokensStaked = preciseMul(issuedSupply, componentPositionUnits);
        expect(newTokenBalance.sub(oldTokenBalance)).eq(expectedTokensStaked);
      });

      it('should update the Default units on the MatrixToken correctly', async function () {
        const oldPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
        await stake();
        const newPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
        expect(oldPositionUnit.sub(newPositionUnit)).eq(componentPositionUnits);
      });

      it('should update the External units and state on the MatrixToken correctly', async function () {
        const oldExternalModules = await matrixToken.getExternalPositionModules(component);
        expect(oldExternalModules.length).eq(1);
        expect(oldExternalModules[0]).eq(stakingModule.address);

        const oldPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
        await stake();
        const newPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
        expect(newPositionUnit.sub(oldPositionUnit)).eq(componentPositionUnits);

        const newExternalModules = await matrixToken.getExternalPositionModules(component);
        expect(newExternalModules.length).eq(1);
        expect(newExternalModules[0]).eq(stakingModule.address);
      });

      it('should create the correct ComponentPosition struct on the StakingModule', async function () {
        await stake();

        const stakingContracts = await stakingModule.getStakingContracts(matrixTokenAddress, component);
        expect(stakingContracts.length).eq(1);
        expect(stakingContracts[0]).eq(stakeContract);

        const position = await stakingModule.getStakingPosition(matrixTokenAddress, component, stakeContract);
        expect(position.componentPositionUnits).eq(componentPositionUnits.mul(2));
      });

      it('should emit the correct StakeComponent event', async function () {
        await expect(stake())
          .emit(stakingModule, 'StakeComponent')
          .withArgs(matrixTokenAddress, component, stakeContract, componentPositionUnits, stakingAdapterMock1.address);
      });
    });

    describe('when module is not initialized', function () {
      before(async function () {
        notInitialized = false;
      });

      after(async function () {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async function () {
        await expect(stake()).revertedWith('M1b');
      });
    });
  });

  describe('unstake', function () {
    let issuedSupply = ethToWei(2);

    let caller;
    let component;
    let adapterName;
    let stakeContract;
    let notInitialized;
    let matrixTokenAddress;
    let componentPositionUnits;

    before(async function () {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      caller = owner;
      adapterName = STAKE_NAME1;
      componentPositionUnits = ethToWei(0.5);
      component = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;
      stakeContract = stakingAdapterMock1.address;

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, issuedSupply, owner.address);

      if (notInitialized) {
        await stakingModule.initialize(matrixToken.address);
        await stakingModule.stake(matrixTokenAddress, stakeContract, component, adapterName, ethToWei(0.5));
      }
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function unstake() {
      return stakingModule.connect(caller).unstake(matrixTokenAddress, stakeContract, component, adapterName, componentPositionUnits);
    }

    it('should transfer the staked tokens to the matrixToken', async function () {
      const oldTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      await unstake();
      const newTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      const expectedTokensStaked = preciseMul(issuedSupply, componentPositionUnits);
      expect(newTokenBalance.sub(oldTokenBalance)).eq(expectedTokensStaked);
    });

    it('should update the Default units on the MatrixToken correctly', async function () {
      const oldPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
      await unstake();
      const newPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
      expect(newPositionUnit.sub(oldPositionUnit)).eq(componentPositionUnits);
    });

    it('should update the External units and state on the MatrixToken correctly', async function () {
      const oldExternalModules = await matrixToken.getExternalPositionModules(component);
      expect(oldExternalModules.length).eq(1);
      expect(oldExternalModules[0]).eq(stakingModule.address);

      const oldPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
      await unstake();
      const newPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
      expect(oldPositionUnit.sub(newPositionUnit)).eq(componentPositionUnits);

      const newExternalModules = await matrixToken.getExternalPositionModules(component);
      expect(newExternalModules.length).eq(0);

      const data = await matrixToken.getExternalPositionData(component, stakingModule.address);
      expect(data).eq(EMPTY_BYTES);
    });

    it("should remove the stakingContract from the component's stakingContracts", async function () {
      const oldStakingContracts = await stakingModule.getStakingContracts(matrixTokenAddress, component);
      expect(oldStakingContracts.length).eq(1);
      expect(oldStakingContracts[0]).eq(stakeContract);

      await unstake();

      const newStakingContracts = await stakingModule.getStakingContracts(matrixTokenAddress, component);
      expect(newStakingContracts.length).eq(0);
    });

    it('should delete the StakingPosition associated with the staking contract', async function () {
      await unstake();
      const position = await stakingModule.getStakingPosition(matrixTokenAddress, component, stakeContract);
      expect(position.adapterHash).eq(ZERO_HASH);
      expect(position.componentPositionUnits).eq(ZERO);
    });

    it('should emit the correct UnstakeComponent event', async function () {
      await expect(unstake())
        .emit(stakingModule, 'UnstakeComponent')
        .withArgs(matrixTokenAddress, component, stakeContract, componentPositionUnits, stakingAdapterMock1.address);
    });

    it('should revert when staking contract not return the expected amount of tokens', async function () {
      await stakingAdapterMock1.setUnstakeFee(ethToWei(0.01));
      await expect(unstake()).revertedWith('SM3');
    });

    it('should revert when trying to unstake more tokens than staked', async function () {
      componentPositionUnits = ethToWei(0.6);
      await expect(unstake()).revertedWith('SM1');
    });

    it('should revert when passed adapterName is not valid', async function () {
      adapterName = 'invalid_adapter';
      await expect(unstake()).revertedWith('M0');
    });

    it('should revert when caller is not manager', async function () {
      caller = randomAccount;
      await expect(unstake()).revertedWith('M1a');
    });

    it('should revert when MatrixToken is not valid', async function () {
      const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [stakingModule.address], owner);
      matrixTokenAddress = nonEnabledToken.address;
      await expect(unstake()).revertedWith('M1b');
    });

    describe('when the full position is not being removed', function () {
      beforeEach(async function () {
        componentPositionUnits = ethToWei(0.25);
      });

      it('should transfer the staked tokens to the MatrixToken', async function () {
        const oldTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
        await unstake();
        const newTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
        const expectedTokensStaked = preciseMul(issuedSupply, componentPositionUnits);
        expect(newTokenBalance.sub(oldTokenBalance)).eq(expectedTokensStaked);
      });

      it('should update the Default units on the MatrixToken correctly', async function () {
        const oldPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
        await unstake();
        const newPositionUnit = await matrixToken.getDefaultPositionRealUnit(component);
        expect(newPositionUnit.sub(oldPositionUnit)).eq(componentPositionUnits);
      });

      it('should update the External units and state on the MatrixToken correctly', async function () {
        const oldExternalModules = await matrixToken.getExternalPositionModules(component);
        expect(oldExternalModules[0]).eq(stakingModule.address);
        expect(oldExternalModules.length).eq(1);

        const oldPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
        await unstake();
        const newPositionUnit = await matrixToken.getExternalPositionRealUnit(component, stakingModule.address);
        expect(oldPositionUnit.sub(newPositionUnit)).eq(componentPositionUnits);

        const newExternalModules = await matrixToken.getExternalPositionModules(component);
        expect(newExternalModules.length).eq(1);
        expect(newExternalModules[0]).eq(oldExternalModules[0]);
      });

      it('should update the ComponentPosition struct on the StakingModule', async function () {
        await unstake();

        const stakingContracts = await stakingModule.getStakingContracts(matrixTokenAddress, component);
        expect(stakingContracts.length).eq(1);
        expect(stakingContracts[0]).eq(stakeContract);

        const position = await stakingModule.getStakingPosition(matrixTokenAddress, component, stakeContract);
        expect(position.componentPositionUnits).eq(ethToWei(0.5).sub(componentPositionUnits));
      });

      it('should emit the correct StakeComponent event', async function () {
        await expect(unstake())
          .emit(stakingModule, 'UnstakeComponent')
          .withArgs(matrixTokenAddress, component, stakeContract, componentPositionUnits, stakingAdapterMock1.address);
      });
    });

    describe('when module is not initialized', function () {
      before(async function () {
        notInitialized = false;
      });

      after(async function () {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async function () {
        await expect(unstake()).revertedWith('M1b');
      });
    });
  });

  describe('issueHook', function () {
    const tokenTransferAmount = ethToWei(0.5);

    let caller;
    let isEquity;
    let component;
    let issuedSupply;
    let notInitialized;
    let matrixTokenAddress;
    let matrixTokenQuantity;

    before(async function () {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      matrixTokenAddress = matrixToken.address;
      component = systemFixture.weth.address;
      matrixTokenQuantity = ethToWei(0.5);
      isEquity = true; // Unused by module
      caller = dummyIssuanceModule;

      issuedSupply = ethToWei(2);
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, issuedSupply, owner.address);

      if (notInitialized) {
        await stakingModule.initialize(matrixToken.address);
        await stakingModule.stake(matrixTokenAddress, stakingAdapterMock1.address, component, STAKE_NAME1, ethToWei(0.5));
        await stakingModule.stake(matrixTokenAddress, stakingAdapterMock2.address, component, STAKE_NAME2, ethToWei(0.5));
      }

      await systemFixture.weth.transfer(matrixToken.address, tokenTransferAmount);
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function componentIssueHook() {
      return stakingModule.connect(caller).componentIssueHook(matrixTokenAddress, matrixTokenQuantity, component, isEquity);
    }

    it('should transfer tokens from matrixToken to staking contract(s)', async function () {
      const oldMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      const oldWeth1Balance = await systemFixture.weth.balanceOf(stakingAdapterMock1.address);
      const oldWeth2Balance = await systemFixture.weth.balanceOf(stakingAdapterMock2.address);

      await componentIssueHook();

      const newMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      const newWeth1Balance = await systemFixture.weth.balanceOf(stakingAdapterMock1.address);
      const newWeth2Balance = await systemFixture.weth.balanceOf(stakingAdapterMock2.address);

      const expectedTokensTransferred = preciseMul(matrixTokenQuantity, ethToWei(1));

      expect(newMatrixTokenBalance).eq(oldMatrixTokenBalance.sub(expectedTokensTransferred));
      expect(newWeth1Balance.sub(oldWeth1Balance)).eq(expectedTokensTransferred.div(2));
      expect(newWeth2Balance.sub(oldWeth2Balance)).eq(expectedTokensTransferred.div(2));
    });

    it('should revert if non-module is caller', async function () {
      caller = owner;
      await expect(componentIssueHook()).revertedWith('M4a');
    });

    it('should revert if disabled module is caller', async function () {
      await systemFixture.controller.removeModule(dummyIssuanceModule.address);
      await expect(componentIssueHook()).revertedWith('M4b');
    });
  });

  describe('redeemHook', function () {
    const tokenTransferAmount = ethToWei(0.5);
    const matrixTokenQuantity = ethToWei(0.5);

    let caller;
    let isEquity;
    let component;
    let issuedSupply;
    let notInitialized;
    let matrixTokenAddress;

    before(async function () {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      isEquity = true; // Unused by module
      caller = dummyIssuanceModule;
      component = systemFixture.weth.address;
      matrixTokenAddress = matrixToken.address;

      issuedSupply = ethToWei(2);
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, issuedSupply, owner.address);

      if (notInitialized) {
        await stakingModule.initialize(matrixToken.address);
        await stakingModule.stake(matrixTokenAddress, stakingAdapterMock1.address, component, STAKE_NAME1, ethToWei(0.5));
        await stakingModule.stake(matrixTokenAddress, stakingAdapterMock2.address, component, STAKE_NAME2, ethToWei(0.5));
      }

      await systemFixture.weth.transfer(matrixToken.address, tokenTransferAmount);
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function componentRedeemHook() {
      return stakingModule.connect(caller).componentRedeemHook(matrixTokenAddress, matrixTokenQuantity, component, isEquity);
    }

    it('should transfer tokens from staking contract(s) to matrixToken', async function () {
      const oldMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      const oldWeth1Balance = await systemFixture.weth.balanceOf(stakingAdapterMock1.address);
      const oldWeth2Balance = await systemFixture.weth.balanceOf(stakingAdapterMock2.address);

      await componentRedeemHook();

      const newMatrixTokenBalance = await systemFixture.weth.balanceOf(matrixTokenAddress);
      const newWeth1Balance = await systemFixture.weth.balanceOf(stakingAdapterMock1.address);
      const newWeth2Balance = await systemFixture.weth.balanceOf(stakingAdapterMock2.address);
      const expectedTokensTransferred = preciseMul(matrixTokenQuantity, ethToWei(1));

      expect(newMatrixTokenBalance.sub(oldMatrixTokenBalance)).eq(expectedTokensTransferred);
      expect(oldWeth1Balance.sub(newWeth1Balance)).eq(expectedTokensTransferred.div(2));
      expect(oldWeth2Balance.sub(newWeth2Balance)).eq(expectedTokensTransferred.div(2));
    });

    it('should revert when staking contract not return the expected amount of tokens', async function () {
      await stakingAdapterMock1.setUnstakeFee(ethToWei(0.01));
      await expect(componentRedeemHook()).revertedWith('SM3');
    });

    it('should revert if non-module is caller', async function () {
      caller = owner;
      await expect(componentRedeemHook()).revertedWith('M4a');
    });

    it('should revert if disabled module is caller', async function () {
      await systemFixture.controller.removeModule(dummyIssuanceModule.address);
      await expect(componentRedeemHook()).revertedWith('M4b');
    });
  });
});
