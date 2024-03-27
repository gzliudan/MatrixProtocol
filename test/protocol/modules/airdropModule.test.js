// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { ethToWei } = require('../../helpers/unitUtil');
const { deployContract } = require('../../helpers/deploy');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { preciseMul, preciseDiv } = require('../../helpers/mathUtil');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { ZERO, ZERO_ADDRESS, PRECISE_UNIT } = require('../../helpers/constants');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');

describe('contract AirdropModule', () => {
  const [owner, protocolFeeRecipient, feeRecipient, tokenHolder] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;

  let caller;
  let matrixToken;
  let airdropModule;
  let matrixTokenAddress;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();

    airdropModule = await deployContract('AirdropModule', [systemFixture.controller.address, 'AirdropModule'], owner);
    await systemFixture.controller.addModule(airdropModule.address);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('initialize', () => {
    let airdrops;
    let airdropFee;
    let anyoneAbsorb;
    let airdropSetting;
    let airdropFeeRecipient;

    before(async () => {
      anyoneAbsorb = true;
      airdropFee = ethToWei(0.2);
      airdropFeeRecipient = feeRecipient.address;
      airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      caller = owner;
      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = matrixToken.address;

      airdropSetting = {
        airdrops,
        feeRecipient: airdropFeeRecipient,
        airdropFee,
        anyoneAbsorb,
      };
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function initialize() {
      return airdropModule.connect(caller).initialize(matrixTokenAddress, airdropSetting);
    }

    it('should set the correct airdrops and anyoneAbsorb fields', async () => {
      await initialize();

      const airdrops = await airdropModule.getAirdrops(matrixTokenAddress);
      const newAirdropSetting = await airdropModule.getAirdropSetting(matrixTokenAddress);

      expect(newAirdropSetting.airdropFee).eq(airdropFee);
      expect(newAirdropSetting.anyoneAbsorb).eq(anyoneAbsorb);
      expect(JSON.stringify(airdrops)).eq(JSON.stringify(airdrops));
    });

    it('should set the correct isAirdrop state', async () => {
      await initialize();

      const wethIsAirdrop = await airdropModule.isAirdropToken(matrixTokenAddress, systemFixture.weth.address);
      const usdcIsAirdrop = await airdropModule.isAirdropToken(matrixTokenAddress, systemFixture.usdc.address);

      expect(wethIsAirdrop).is.true;
      expect(usdcIsAirdrop).is.true;
    });

    describe('when the airdrops array is empty', () => {
      before(async () => {
        airdrops = [];
      });

      after(async () => {
        airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
      });

      it('should set the airdrops with an empty array', async () => {
        await initialize();
        const airdrops = await airdropModule.getAirdrops(matrixTokenAddress);
        expect(airdrops).is.empty;
      });
    });

    describe('when there are duplicate components in the airdrops array', () => {
      before(async () => {
        airdrops = [systemFixture.weth.address, systemFixture.weth.address];
      });

      after(async () => {
        airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
      });

      it('should revert when there are duplicate components in the airdrops array', async () => {
        await expect(initialize()).revertedWith('AD2c');
      });
    });

    describe('when the airdrop fee is greater than 100%', () => {
      before(async () => {
        airdropFee = ethToWei(1.01);
      });

      after(async () => {
        airdropFee = ethToWei(0.2);
      });

      it('should revert when the airdrop fee is greater than 100%', async () => {
        await expect(initialize()).revertedWith('AD2b');
      });
    });

    describe('when the fee recipient is the ZERO_ADDRESS', () => {
      before(async () => {
        airdropFeeRecipient = ZERO_ADDRESS;
      });

      after(async () => {
        airdropFeeRecipient = feeRecipient.address;
      });

      it('should revert when the fee recipient is the ZERO_ADDRESS', async () => {
        await expect(initialize()).revertedWith('AD2a');
      });
    });

    it('should revert when the caller is not the MatrixToken manager', async () => {
      caller = tokenHolder;
      await expect(initialize()).revertedWith('M2');
    });

    it('should revert when module is in NONE state', async () => {
      await initialize();
      await matrixToken.removeModule(airdropModule.address);
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when module is in INITIALIZED state', async () => {
      await initialize();
      await expect(initialize()).revertedWith('M5b');
    });

    it('should revert when the MatrixToken is not enabled on the controller', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(initialize()).revertedWith('M5a');
    });
  });

  describe('absorb', () => {
    let token;
    let airdrops;
    let airdropFee;
    let protocolFee;
    let anyoneAbsorb;
    let notInitialized;
    let airdropAmounts;

    before(async () => {
      anyoneAbsorb = true;
      notInitialized = true;
      airdropFee = ethToWei(0.2);
      protocolFee = ethToWei(0.15);
      airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
      airdropAmounts = [BigNumber.from(10 ** 10), ethToWei(2)];
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      await systemFixture.controller.addFee(airdropModule.address, ZERO, protocolFee);
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [airdropModule.address, systemFixture.basicIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      token = systemFixture.usdc.address;
      caller = tokenHolder;

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      if (notInitialized) {
        const airdropSetting = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1.124), owner.address);
      await systemFixture.usdc.transfer(matrixToken.address, airdropAmounts[0]);
      await systemFixture.weth.transfer(matrixToken.address, airdropAmounts[1]);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function absorb() {
      return airdropModule.connect(caller).absorb(matrixTokenAddress, token);
    }

    it('should create the correct new usdc position', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      await absorb();
      const newPositions = await matrixToken.getPositions();

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

      expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
    });

    it('should transfer the correct usdc amount to the matrixToken feeRecipient', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
      await absorb();
      const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      expect(newUsdcBalanceOfManager.sub(oldUsdcBalanceOfManager)).eq(expectedManagerTake);
    });

    it('should transfer the correct usdc amount to the protocol feeRecipient', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      const oldUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
      await absorb();
      const newUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      expect(newUsdcBalanceOfProtocol.sub(oldUsdcBalanceOfProtocol)).eq(expectedProtocolTake);
    });

    it('should emit the correct AbsorbComponent event for USDC', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;
      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      await expect(absorb())
        .emit(airdropModule, 'AbsorbComponent')
        .withArgs(matrixToken.address, systemFixture.usdc.address, airdroppedTokens, expectedManagerTake, expectedProtocolTake);
    });

    describe('when protocolFee is 0 but airdropFee > 0', () => {
      before(async () => {
        protocolFee = ZERO;
      });

      after(async () => {
        protocolFee = ethToWei(0.15);
      });

      it('should create the correct new usdc position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await absorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer the correct usdc amount to the matrixToken feeRecipient', async () => {
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
        await absorb();
        const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        expect(newUsdcBalanceOfManager.sub(oldUsdcBalanceOfManager)).eq(expectedManagerTake);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        await absorb();
        const newUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        expect(newUsdcBalanceOfProtocol).eq(oldUsdcBalanceOfProtocol);
      });
    });

    describe('when airdropFee is 0', () => {
      before(async () => {
        airdropFee = ZERO;
      });

      after(async () => {
        airdropFee = ethToWei(0.15);
      });

      it('should create the correct new usdc position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await absorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer nothing to the matrixToken feeRecipient', async () => {
        const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
        await absorb();
        const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
        expect(newUsdcBalanceOfManager).eq(oldUsdcBalanceOfManager);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        await absorb();
        const newUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        expect(newUsdcBalanceOfProtocol).eq(oldUsdcBalanceOfProtocol);
      });
    });

    describe('when anyoneAbsorb is false and the caller is the MatrixToken manager', () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it('should create the correct new usdc position', async () => {
        caller = owner;
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await absorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });
    });

    describe('when anyoneAbsorb is false and the caller is not the MatrixToken manager', () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it('should revert when anyoneAbsorb is false and the caller is not the MatrixToken manager', async () => {
        await expect(absorb()).revertedWith('AD6');
      });
    });

    it('should revert when passed token is not an approved airdrop', async () => {
      token = systemFixture.wbtc.address;
      await expect(absorb()).revertedWith('AD3');
    });

    describe('when module is not initialized', () => {
      before(async () => {
        notInitialized = false;
      });

      after(async () => {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async () => {
        caller = owner;
        await expect(absorb()).revertedWith('M3');
      });
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      caller = owner;
      await expect(absorb()).revertedWith('M3');
    });
  });

  describe('batchAbsorb', () => {
    let tokens;
    let airdrops;
    let airdropFee;
    let protocolFee;
    let anyoneAbsorb;
    let notInitialized;
    let airdropAmounts;

    before(async () => {
      anyoneAbsorb = true;
      notInitialized = true;
      airdropFee = ethToWei(0.2);
      protocolFee = ethToWei(0.15);
      airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
      airdropAmounts = [BigNumber.from(10 ** 10), ethToWei(2)];
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      await systemFixture.controller.addFee(airdropModule.address, ZERO, protocolFee);
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [airdropModule.address, systemFixture.basicIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      tokens = [systemFixture.usdc.address, systemFixture.weth.address];
      caller = tokenHolder;

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      if (notInitialized) {
        const airdropSetting = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1.124), owner.address);
      await systemFixture.usdc.transfer(matrixToken.address, airdropAmounts[0]);
      await systemFixture.weth.transfer(matrixToken.address, airdropAmounts[1]);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function batchAbsorb() {
      return airdropModule.connect(caller).batchAbsorb(matrixTokenAddress, tokens);
    }

    it('should create the correct new usdc position', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;
      const totalSupply = await matrixToken.totalSupply();

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      await batchAbsorb();
      const newPositions = await matrixToken.getPositions();

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

      expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
    });

    it('should transfer the correct usdc amount to the matrixToken feeRecipient', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
      await batchAbsorb();
      const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      expect(newUsdcBalanceOfManager.sub(oldUsdcBalanceOfManager)).eq(expectedManagerTake);
    });

    it('should transfer the correct usdc amount to the protocol feeRecipient', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      const oldBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
      await batchAbsorb();
      const newBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      expect(newBalanceOfProtocol.sub(oldBalanceOfProtocol)).eq(expectedProtocolTake);
    });

    it('should emit the correct AbsorbComponent event for USDC', async () => {
      const usdcBalanceBeforeAirdrop = ZERO;
      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      await expect(batchAbsorb())
        .emit(airdropModule, 'AbsorbComponent')
        .withArgs(matrixToken.address, systemFixture.usdc.address, airdroppedTokens, expectedManagerTake, expectedProtocolTake);
    });

    it('should create the correct new eth position', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const oldPositions = await matrixToken.getPositions();
      const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

      const oldWethbalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
      await batchAbsorb();
      const newPositions = await matrixToken.getPositions();

      const airdroppedTokens = oldWethbalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
      const netBalance = oldWethbalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

      expect(newPositions[0].unit).eq(preciseDiv(netBalance, totalSupply));
    });

    it('should transfer the correct weth amount to the matrixToken feeRecipient', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const oldPositions = await matrixToken.getPositions();
      const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

      const oldWethbalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
      const oldWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);
      await batchAbsorb();
      const newWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);

      const airdroppedTokens = oldWethbalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      expect(newWethBalanceOfManager.sub(oldWethBalanceOfManager)).eq(expectedManagerTake);
    });

    it('should transfer the correct weth amount to the protocol feeRecipient', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const oldPositions = await matrixToken.getPositions();
      const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

      const oldWethbalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
      await batchAbsorb();
      const actualProtocolTake = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);

      const airdroppedTokens = oldWethbalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      expect(actualProtocolTake).eq(expectedProtocolTake);
    });

    it('should emit the correct AbsorbComponent event for WETH', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const oldPositions = await matrixToken.getPositions();
      const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);
      const oldWethbalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
      const airdroppedTokens = oldWethbalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      await expect(batchAbsorb())
        .emit(airdropModule, 'AbsorbComponent')
        .withArgs(matrixToken.address, systemFixture.weth.address, airdroppedTokens, expectedManagerTake, expectedProtocolTake);
    });

    describe('when protocolFee is 0 but airdropFee > 0', () => {
      before(async () => {
        protocolFee = ZERO;
      });

      after(async () => {
        protocolFee = ethToWei(0.15);
      });

      it('should create the correct new usdc position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer the correct usdc amount to the matrixToken feeRecipient', async () => {
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);
        await batchAbsorb();
        const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(feeRecipient.address);

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        expect(newUsdcBalanceOfManager.sub(oldUsdcBalanceOfManager)).eq(expectedManagerTake);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        await batchAbsorb();
        const newUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        expect(newUsdcBalanceOfProtocol).eq(oldUsdcBalanceOfProtocol);
      });

      it('should create the correct new eth position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const oldPositions = await matrixToken.getPositions();
        const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldWethBalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
        const netBalance = oldWethBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[0].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer the correct weth amount to the matrixToken feeRecipient', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const oldPositions = await matrixToken.getPositions();
        const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
        const oldWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);
        await batchAbsorb();
        const newWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);

        const airdroppedTokens = oldWethBalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        expect(newWethBalanceOfManager.sub(oldWethBalanceOfManager)).eq(expectedManagerTake);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldWethBalanceOfProtocol = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
        await batchAbsorb();
        const newWethBalanceOfProtocol = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
        expect(newWethBalanceOfProtocol).eq(oldWethBalanceOfProtocol);
      });
    });

    describe('when airdropFee is 0', () => {
      before(async () => {
        airdropFee = ZERO;
      });

      after(async () => {
        airdropFee = ethToWei(0.15);
      });

      it('should create the correct new usdc position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer nothing to the MatrixToken feeRecipient', async () => {
        const oldUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        await batchAbsorb();
        const newUsdcBalanceOfManager = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        expect(newUsdcBalanceOfManager).eq(oldUsdcBalanceOfManager);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        await batchAbsorb();
        const newUsdcBalanceOfProtocol = await systemFixture.usdc.balanceOf(protocolFeeRecipientAddress);
        expect(newUsdcBalanceOfProtocol).eq(oldUsdcBalanceOfProtocol);
      });

      it('should create the correct new eth position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const oldPositions = await matrixToken.getPositions();
        const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldWethBalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
        const netBalance = oldWethBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[0].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should transfer nothing to the MatrixToken feeRecipient', async () => {
        const oldWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);
        await batchAbsorb();
        const newWethBalanceOfManager = await systemFixture.weth.balanceOf(feeRecipient.address);
        expect(newWethBalanceOfManager).eq(oldWethBalanceOfManager);
      });

      it('should transfer nothing to the protocol feeRecipient', async () => {
        const oldWethBalanceOfProtocol = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
        await batchAbsorb();
        const newWethBalanceOfProtocol = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
        expect(newWethBalanceOfProtocol).eq(oldWethBalanceOfProtocol);
      });
    });

    describe('when anyoneAbsorb is false and the caller is the MatrixToken manager', () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      beforeEach(async () => {
        caller = owner;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it('should create the correct new usdc position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const usdcBalanceBeforeAirdrop = ZERO;

        const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
        const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
      });

      it('should create the correct new eth position', async () => {
        const totalSupply = await matrixToken.totalSupply();
        const oldPositions = await matrixToken.getPositions();
        const wethBalanceBeforeAirdrop = preciseMul(oldPositions[0].unit, totalSupply);

        const oldWethBalanceOfMatrix = await systemFixture.weth.balanceOf(matrixToken.address);
        await batchAbsorb();
        const newPositions = await matrixToken.getPositions();

        const airdroppedTokens = oldWethBalanceOfMatrix.sub(wethBalanceBeforeAirdrop);
        const netBalance = oldWethBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

        expect(newPositions[0].unit).eq(preciseDiv(netBalance, totalSupply));
      });
    });

    it('should revert when a passed token is not enabled by the manager', async () => {
      tokens = [systemFixture.usdc.address, systemFixture.wbtc.address];
      await expect(batchAbsorb()).revertedWith('AD3');
    });

    describe('when anyoneAbsorb is false and the caller is not the MatrixToken manager', () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it('should revert when anyoneAbsorb is false and the caller is not the MatrixToken manager', async () => {
        await expect(batchAbsorb()).revertedWith('AD6');
      });
    });

    describe('when module is not initialized', () => {
      before(async () => {
        notInitialized = false;
      });

      after(async () => {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async () => {
        caller = owner;
        await expect(batchAbsorb()).revertedWith('M3');
      });
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      caller = owner;
      await expect(batchAbsorb()).revertedWith('M3');
    });
  });

  describe('removeModule', () => {
    let module;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      module = airdropModule.address;

      const airdropSetting = {
        airdrops: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        airdropFee: ethToWei(0.2),
        anyoneAbsorb: true,
      };

      await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function removeModule() {
      return matrixToken.removeModule(module);
    }

    it('should delete the airdropSetting', async () => {
      await removeModule();
      const airdrops = await airdropModule.getAirdrops(matrixToken.address);
      const newAirdropSetting = await airdropModule.getAirdropSetting(matrixToken.address);

      expect(airdrops).is.empty;
      expect(newAirdropSetting.airdropFee).eq(ZERO);
      expect(newAirdropSetting.anyoneAbsorb).is.false;
    });

    it('should reset the isAirdrop mapping', async () => {
      await removeModule();
      expect(await airdropModule.isAirdropToken(module, systemFixture.weth.address)).is.false;
      expect(await airdropModule.isAirdropToken(module, systemFixture.usdc.address)).is.false;
    });
  });

  describe('addAirdrop and removeAirdrop', () => {
    let notInitialized;
    let airdropTokenAddress;

    before(async () => {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);

      if (notInitialized) {
        const airdropSetting = {
          airdrops: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          airdropFee: ethToWei(0.2),
          anyoneAbsorb: true,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    describe('addAirdrop', () => {
      beforeEach(async () => {
        caller = owner;
        airdropTokenAddress = systemFixture.wbtc.address;
        matrixTokenAddress = matrixToken.address;
      });

      async function addAirdrop() {
        return airdropModule.connect(caller).addAirdrop(matrixTokenAddress, airdropTokenAddress);
      }

      it('should add the new token', async () => {
        expect(await airdropModule.getAirdrops(matrixToken.address)).not.contain(airdropTokenAddress);
        await addAirdrop();
        expect(await airdropModule.getAirdrops(matrixToken.address)).contain(airdropTokenAddress);
      });

      it('should add the new token', async () => {
        expect(await airdropModule.isAirdropToken(matrixTokenAddress, airdropTokenAddress)).is.false;
        await addAirdrop();
        expect(await airdropModule.isAirdropToken(matrixTokenAddress, airdropTokenAddress)).is.true;
      });

      it('should emit the correct AddAirdropComponent event', async () => {
        await expect(addAirdrop()).emit(airdropModule, 'AddAirdropComponent').withArgs(matrixTokenAddress, airdropTokenAddress);
      });

      it('should revert when airdrop has already been added', async () => {
        airdropTokenAddress = systemFixture.usdc.address;
        await expect(addAirdrop()).revertedWith('AD4');
      });

      it('should revert when MatrixToken is not valid', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
        matrixTokenAddress = newToken.address;
        await expect(addAirdrop()).revertedWith('M1b');
      });

      describe('when module is not initialized', () => {
        before(async () => {
          notInitialized = false;
        });

        after(async () => {
          notInitialized = true;
        });

        it('should revert when module is not initialized', async () => {
          await expect(addAirdrop()).revertedWith('M1b');
        });
      });
    });

    describe('removeAirdrop', () => {
      beforeEach(async () => {
        caller = owner;
        airdropTokenAddress = systemFixture.usdc.address;
        matrixTokenAddress = matrixToken.address;
      });

      async function removeAirdrop() {
        return airdropModule.connect(caller).removeAirdrop(matrixTokenAddress, airdropTokenAddress);
      }

      it('should remove the token - getAirdrops', async () => {
        expect(await airdropModule.getAirdrops(matrixToken.address)).contain(airdropTokenAddress);
        await removeAirdrop();
        expect(await airdropModule.getAirdrops(matrixToken.address)).not.contain(airdropTokenAddress);
      });

      it('should remove the token - isAirdropToken', async () => {
        expect(await airdropModule.isAirdropToken(matrixTokenAddress, airdropTokenAddress)).is.true;
        await removeAirdrop();
        expect(await airdropModule.isAirdropToken(matrixTokenAddress, airdropTokenAddress)).is.false;
      });

      it('should emit the correct RemoveAirdropComponent event', async () => {
        await expect(removeAirdrop()).emit(airdropModule, 'RemoveAirdropComponent').withArgs(matrixTokenAddress, airdropTokenAddress);
      });

      it('should revert when airdrop is not in the airdrops array', async () => {
        airdropTokenAddress = systemFixture.wbtc.address;
        await expect(removeAirdrop()).revertedWith('AD5');
      });

      it('should revert when MatrixToken is not valid', async () => {
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
        matrixTokenAddress = newToken.address;
        await expect(removeAirdrop()).revertedWith('M1b');
      });

      describe('when module is not initialized', () => {
        before(async () => {
          notInitialized = false;
        });

        after(async () => {
          notInitialized = true;
        });

        it('should revert when module is not initialized', async () => {
          await expect(removeAirdrop()).revertedWith('M1b');
        });
      });
    });
  });

  describe('updateAirdropFee', () => {
    let newFee;
    let airdrops;
    let airdropFee;
    let protocolFee;
    let anyoneAbsorb;
    let airdropAmounts;
    let notInitialized;

    before(async () => {
      anyoneAbsorb = true;
      notInitialized = true;
      airdropFee = ethToWei(0.2);
      protocolFee = ethToWei(0.15);
      airdrops = [systemFixture.usdc.address, systemFixture.weth.address];
      airdropAmounts = [BigNumber.from(10 ** 10), ethToWei(2)];
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      await systemFixture.controller.addFee(airdropModule.address, ZERO, protocolFee);
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address],
        [ethToWei(1)],
        [airdropModule.address, systemFixture.basicIssuanceModule.address],
        owner.address
      );
      matrixTokenAddress = matrixToken.address;
      newFee = ethToWei(0.5);
      caller = owner;

      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
      if (notInitialized) {
        const airdropSetting = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1.124), owner.address);
      await systemFixture.usdc.transfer(matrixToken.address, airdropAmounts[0]);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function updateAirdropFee() {
      return airdropModule.connect(caller).updateAirdropFee(matrixTokenAddress, newFee);
    }

    it('should create the correct new usdc position', async () => {
      const totalSupply = await matrixToken.totalSupply();
      const usdcBalanceBeforeAirdrop = ZERO;

      const oldUsdcBalanceOfMatrix = await systemFixture.usdc.balanceOf(matrixToken.address);
      await updateAirdropFee();
      const newPositions = await matrixToken.getPositions();

      const airdroppedTokens = oldUsdcBalanceOfMatrix.sub(usdcBalanceBeforeAirdrop);
      const netBalance = oldUsdcBalanceOfMatrix.sub(preciseMul(airdroppedTokens, airdropFee));

      expect(newPositions[1].unit).eq(preciseDiv(netBalance, totalSupply));
    });

    it('should set the new fee', async () => {
      await updateAirdropFee();
      const newAirdropSetting = await airdropModule.getAirdropSetting(matrixToken.address);
      expect(newAirdropSetting.airdropFee).eq(newFee);
    });

    it('should emit the correct UpdateAirdropFee event', async () => {
      await expect(updateAirdropFee()).emit(airdropModule, 'UpdateAirdropFee').withArgs(matrixTokenAddress, newFee);
    });

    it('should revert when new fee exceeds 100%', async () => {
      newFee = ethToWei(1.1);
      await expect(updateAirdropFee()).revertedWith('AD1');
    });

    describe('when module is not initialized', () => {
      before(async () => {
        notInitialized = false;
      });

      after(async () => {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async () => {
        await expect(updateAirdropFee()).revertedWith('M3');
      });
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(updateAirdropFee()).revertedWith('M3');
    });
  });

  describe('updateAnyoneAbsorb', () => {
    let notInitialized;
    let isAnyoneAbsorb;

    before(async () => {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = matrixToken.address;
      isAnyoneAbsorb = true;
      caller = owner;

      if (notInitialized) {
        const airdropSetting = {
          airdrops: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          airdropFee: ethToWei(0.2),
          anyoneAbsorb: false,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function updateAnyoneAbsorb() {
      return airdropModule.connect(caller).updateAnyoneAbsorb(matrixTokenAddress, isAnyoneAbsorb);
    }

    it('should flip the anyoneAbsorb indicator', async () => {
      await updateAnyoneAbsorb();
      const newAirdropSetting = await airdropModule.getAirdropSetting(matrixToken.address);
      expect(newAirdropSetting.anyoneAbsorb).is.true;
    });

    it('should emit the correct UpdateAnyoneAbsorb event', async () => {
      await expect(updateAnyoneAbsorb()).emit(airdropModule, 'UpdateAnyoneAbsorb').withArgs(matrixTokenAddress, isAnyoneAbsorb);
    });

    describe('when module is not initialized', () => {
      before(async () => {
        notInitialized = false;
      });

      after(async () => {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async () => {
        await expect(updateAnyoneAbsorb()).revertedWith('M1b');
      });
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(updateAnyoneAbsorb()).revertedWith('M1b');
    });
  });

  describe('updateFeeRecipient', () => {
    let notInitialized;
    let newFeeRecipient;

    before(async () => {
      notInitialized = true;
    });

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      newFeeRecipient = await getRandomAddress();
      matrixTokenAddress = matrixToken.address;
      caller = owner;

      if (notInitialized) {
        const airdropSetting = {
          airdrops: [systemFixture.usdc.address, systemFixture.weth.address],
          feeRecipient: feeRecipient.address,
          airdropFee: ethToWei(0.2),
          anyoneAbsorb: true,
        };

        await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
      }
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function updateFeeRecipient() {
      return airdropModule.connect(caller).updateFeeRecipient(matrixTokenAddress, newFeeRecipient);
    }

    it('should change the fee recipient to the new address', async () => {
      await updateFeeRecipient();
      const newAirdropSetting = await airdropModule.getAirdropSetting(matrixToken.address);
      expect(newAirdropSetting.feeRecipient).eq(newFeeRecipient);
    });

    it('should emit the correct UpdateFeeRecipient event', async () => {
      await expect(updateFeeRecipient()).emit(airdropModule, 'UpdateFeeRecipient').withArgs(matrixTokenAddress, newFeeRecipient);
    });

    it('should revert when passed address is zero', async () => {
      newFeeRecipient = ZERO_ADDRESS;
      await expect(updateFeeRecipient()).revertedWith('AD0');
    });

    describe('when module is not initialized', () => {
      before(async () => {
        notInitialized = false;
      });

      after(async () => {
        notInitialized = true;
      });

      it('should revert when module is not initialized', async () => {
        await expect(updateFeeRecipient()).revertedWith('M1b');
      });
    });

    it('should revert when MatrixToken is not valid', async () => {
      const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = newToken.address;
      await expect(updateFeeRecipient()).revertedWith('M1b');
    });
  });

  describe('getAirdrops', () => {
    let airdrops;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = matrixToken.address;
      airdrops = [systemFixture.usdc.address, systemFixture.weth.address];

      const airdropSetting = {
        airdrops,
        feeRecipient: feeRecipient.address,
        airdropFee: ethToWei(0.2),
        anyoneAbsorb: true,
      };

      await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    it('should return the airdops array', async () => {
      const actualAirdrops = await airdropModule.getAirdrops(matrixTokenAddress);
      expect(JSON.stringify(actualAirdrops)).eq(JSON.stringify(airdrops));
    });
  });

  describe('isAirdrop', () => {
    let token;

    let snapshotId;
    beforeEach(async () => {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [airdropModule.address], owner.address);
      matrixTokenAddress = matrixToken.address;
      token = systemFixture.usdc.address;

      const airdropSetting = {
        airdrops: [systemFixture.usdc.address, systemFixture.weth.address],
        feeRecipient: feeRecipient.address,
        airdropFee: ethToWei(0.2),
        anyoneAbsorb: true,
      };

      await airdropModule.connect(owner).initialize(matrixToken.address, airdropSetting);
    });

    afterEach(async () => {
      await revertBlockchain(snapshotId);
    });

    async function isAirdropToken() {
      return airdropModule.isAirdropToken(matrixTokenAddress, token);
    }

    it('should return true', async () => {
      expect(await isAirdropToken()).is.true;
    });

    it('should return true when token not included in airdrops array', async () => {
      token = systemFixture.wbtc.address;
      expect(await isAirdropToken()).is.false;
    });
  });
});
