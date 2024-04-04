// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;
const { Web3 } = require('web3');
const web3 = new Web3();

// ==================== Internal Imports ====================

const { ethToWei } = require('../../helpers/unitUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { AaveV2Fixture } = require('../../fixtures/aaveV2Fixture');
const { UniswapFixture } = require('../../fixtures/uniswapFixture');
const { preciseMul, preciseDiv } = require('../../helpers/mathUtil');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');
const { deployContract, deployContractAndLinkLibraries } = require('../../helpers/deploy');
const { ZERO, ZERO_ADDRESS, EMPTY_BYTES, MAX_UINT_256 } = require('../../helpers/constants');

describe('contract AaveLeverageModule', function () {
  const [owner, protocolFeeRecipient, mockModule, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const protocolFeeRecipientAddress = protocolFeeRecipient.address;
  const aaveV2Fixture = new AaveV2Fixture(owner);

  let aaveV2Library; // library AaveV2
  let aaveLeverageModule;
  let debtIssuanceMock;

  let aWETH; // AaveV2AToken
  let aDAI; // AaveV2AToken
  let variableDebtWETH; // VariableDebtToken
  let variableDebtDAI; // VariableDebtToken

  let oneInchFunctionSignature; // Bytes
  let oneInchExchangeMockToWeth; // OneInchExchangeMock
  let oneInchExchangeMockFromWeth; // OneInchExchangeMock
  let oneInchExchangeMockWithSlippage; // OneInchExchangeMock
  let oneInchExchangeMockOneWei; // OneInchExchangeMock

  let oneInchExchangeAdapterToWeth; // OneInchExchangeAdapter
  let oneInchExchangeAdapterFromWeth; // OneInchExchangeAdapter

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    await systemFixture.initAll();
    await aaveV2Fixture.init(systemFixture.weth.address, systemFixture.dai.address);

    // Create a WBTC reserve
    await aaveV2Fixture.createAndEnableReserve(
      systemFixture.wbtc.address,
      'WBTC',
      18,
      8000, // base LTV: 80%
      8250, // liquidation threshold: 82.5%
      10500, // liquidation bonus: 105.00%
      1000, // reserve factor: 10%
      true, // enable borrowing on reserve
      true // enable stable debts
    );

    // Create liquidity
    const ape = randomAccount; // The wallet which aped in first and added initial liquidity

    await systemFixture.weth.transfer(ape.address, ethToWei(50));
    await systemFixture.weth.connect(ape).approve(aaveV2Fixture.lendingPool.address, ethToWei(50));
    await aaveV2Fixture.lendingPool.connect(ape).deposit(systemFixture.weth.address, ethToWei(50), ape.address, ZERO);

    await systemFixture.dai.transfer(ape.address, ethToWei(50000));
    await systemFixture.dai.connect(ape).approve(aaveV2Fixture.lendingPool.address, ethToWei(50000));
    await aaveV2Fixture.lendingPool.connect(ape).deposit(systemFixture.dai.address, ethToWei(50000), ape.address, ZERO);

    aWETH = aaveV2Fixture.wethReserveTokens.aToken;
    variableDebtWETH = aaveV2Fixture.wethReserveTokens.variableDebtToken;

    aDAI = aaveV2Fixture.daiReserveTokens.aToken;
    variableDebtDAI = aaveV2Fixture.daiReserveTokens.variableDebtToken;

    debtIssuanceMock = await deployContract('DebtIssuanceMock', [], owner);
    await systemFixture.controller.addModule(debtIssuanceMock.address);

    aaveV2Library = await deployContract('AaveV2', [], owner);

    aaveLeverageModule = await deployContractAndLinkLibraries(
      'AaveLeverageModule',
      [systemFixture.controller.address, aaveV2Fixture.lendingPoolAddressesProvider.address, 'AaveLeverageModule'],
      { AaveV2: aaveV2Library.address },
      owner
    );
    await systemFixture.controller.addModule(aaveLeverageModule.address);

    // Deploy one inch mock contracts

    // one inch function signature
    const functionSignature = 'swap(address,address,uint256,uint256,uint256,address,address[],bytes,uint256[],uint256[])';
    oneInchFunctionSignature = web3.eth.abi.encodeFunctionSignature(functionSignature);

    // Mock OneInch exchange that allows for fixed exchange amounts. So we need to systemFixture separate exchange adapters
    oneInchExchangeMockToWeth = await deployContract(
      'OneInchExchangeMock',
      [
        systemFixture.dai.address,
        systemFixture.weth.address,
        ethToWei(1000), // 1000 DAI
        ethToWei(1), // Trades for 1 WETH
      ],
      owner
    );

    oneInchExchangeAdapterToWeth = await deployContract(
      'OneInchExchangeAdapter',
      [oneInchExchangeMockToWeth.address, oneInchExchangeMockToWeth.address, oneInchFunctionSignature],
      owner
    );

    await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'ONE_INCH_TO_WETH', oneInchExchangeAdapterToWeth.address);

    oneInchExchangeMockFromWeth = await deployContract(
      'OneInchExchangeMock',
      [
        systemFixture.weth.address,
        systemFixture.dai.address,
        ethToWei(1), // 1 WETH
        ethToWei(1000), // Trades for 1000 DAI
      ],
      owner
    );

    oneInchExchangeAdapterFromWeth = await deployContract(
      'OneInchExchangeAdapter',
      [oneInchExchangeMockFromWeth.address, oneInchExchangeMockFromWeth.address, oneInchFunctionSignature],
      owner
    );

    await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'ONE_INCH_FROM_WETH', oneInchExchangeAdapterFromWeth.address);

    // Setup Mock one inch exchange that does not return sufficient units to satisfy slippage requirement
    oneInchExchangeMockWithSlippage = await deployContract(
      'OneInchExchangeMock',
      [
        systemFixture.dai.address,
        systemFixture.weth.address,
        ethToWei(1000), // 1000 DAI
        ethToWei(0.9), // Trades for 0.9 WETH
      ],
      owner
    );

    const oneInchExchangeAdapterWithSlippage = await deployContract(
      'OneInchExchangeAdapter',
      [oneInchExchangeMockWithSlippage.address, oneInchExchangeMockWithSlippage.address, oneInchFunctionSignature],
      owner
    );

    await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'ONE_INCH_SLIPPAGE', oneInchExchangeAdapterWithSlippage.address);

    // Setup Mock one inch exchange that takes in 1 wei of DAI
    oneInchExchangeMockOneWei = await deployContract(
      'OneInchExchangeMock',
      [
        systemFixture.dai.address,
        systemFixture.weth.address,
        1, // 1 wei of DAI
        ethToWei(1), // Trades for 1 WETH
      ],
      owner
    );

    const oneInchExchangeAdapterOneWei = await await deployContract(
      'OneInchExchangeAdapter',
      [oneInchExchangeMockOneWei.address, oneInchExchangeMockOneWei.address, oneInchFunctionSignature],
      owner
    );

    await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'ONE_INCH_WEI', oneInchExchangeAdapterOneWei.address);

    // Add debt issuance address to integration
    await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'DEFAULT_ISSUANCE_MODULE', debtIssuanceMock.address);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', function () {
    it('should set the correct controller', async function () {
      const controller = await aaveLeverageModule.getController();
      expect(controller).eq(systemFixture.controller.address);
    });

    it('should set the correct Aave contracts', async function () {
      const lendingPoolAddressesProvider = await aaveLeverageModule.getLendingPoolAddressesProvider();
      const protocolDataProvider = await aaveLeverageModule.getProtocolDataProvider();

      expect(lendingPoolAddressesProvider).eq(aaveV2Fixture.lendingPoolAddressesProvider.address);
      expect(protocolDataProvider).eq(aaveV2Fixture.protocolDataProvider.address);
    });

    it('should set the correct underlying to reserve tokens mappings', async function () {
      const wethReserveTokens = await aaveLeverageModule.getUnderlyingToReserveTokens(systemFixture.weth.address);
      const daiReserveTokens = await aaveLeverageModule.getUnderlyingToReserveTokens(systemFixture.dai.address);

      expect(wethReserveTokens.aToken).eq(aWETH.address);
      expect(wethReserveTokens.variableDebtToken).eq(aaveV2Fixture.wethReserveTokens.variableDebtToken.address);
      expect(daiReserveTokens.aToken).eq(aaveV2Fixture.daiReserveTokens.aToken.address);
      expect(daiReserveTokens.variableDebtToken).eq(aaveV2Fixture.daiReserveTokens.variableDebtToken.address);
    });
  });

  describe('initialize', function () {
    let caller;
    let isAllowed;
    let matrixToken;
    let matrixTokenAddress;
    let collateralAssets;
    let borrowAssets;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address, systemFixture.dai.address],
        [ethToWei(1), ethToWei(100)],
        [aaveLeverageModule.address, debtIssuanceMock.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      if (isAllowed) {
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true); // Add MatrixToken to allow list
      }
    }

    function initVariables() {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
      collateralAssets = [systemFixture.weth.address, systemFixture.dai.address];
      borrowAssets = [systemFixture.dai.address, systemFixture.weth.address];
    }

    async function initialize() {
      return aaveLeverageModule.connect(caller).initialize(matrixTokenAddress, collateralAssets, borrowAssets);
    }

    describe('when isAllowed is true', function () {
      beforeEach(async function () {
        isAllowed = true;
        await initContracts();
        initVariables();
      });

      it('should enable the Module on the MatrixToken', async function () {
        await initialize();
        const isModuleEnabled = await matrixToken.isInitializedModule(aaveLeverageModule.address);
        expect(isModuleEnabled).is.true;
      });

      it('should set the Aave settings and mappings', async function () {
        await initialize();

        const [realCollateralAssets, realBorrowAssets] = await aaveLeverageModule.getEnabledAssets(matrixToken.address);

        const isWethCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.weth.address);
        const isDaiCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.dai.address);
        const isDaiBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.dai.address);
        const isWethBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.weth.address);

        expect(JSON.stringify(realCollateralAssets)).eq(JSON.stringify(collateralAssets));
        expect(JSON.stringify(realBorrowAssets)).eq(JSON.stringify(borrowAssets));
        expect(isWethCollateral).is.true;
        expect(isDaiCollateral).is.true;
        expect(isDaiBorrow).is.true;
        expect(isWethBorrow).is.true;
      });

      it('should register on the debt issuance module', async function () {
        await initialize();
        const isRegistered = await debtIssuanceMock.isRegistered(matrixToken.address);
        expect(isRegistered).is.true;
      });

      describe('when debt issuance module is not added to integration registry', function () {
        beforeEach(async function () {
          await systemFixture.integrationRegistry.removeIntegration(aaveLeverageModule.address, 'DEFAULT_ISSUANCE_MODULE');
        });

        afterEach(async function () {
          // Add debt issuance address to integration
          await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'DEFAULT_ISSUANCE_MODULE', debtIssuanceMock.address);
        });

        it('should revert when debt issuance module is not added to integration registry', async function () {
          await expect(initialize()).revertedWith('M0');
        });
      });

      describe('when debt issuance module is not initialized on MatrixToken', function () {
        beforeEach(async function () {
          await matrixToken.removeModule(debtIssuanceMock.address);
        });

        afterEach(async function () {
          await matrixToken.addModule(debtIssuanceMock.address);
          await debtIssuanceMock.initialize(matrixToken.address);
        });

        it('should revert when debt issuance module is not initialized on MatrixToken', async function () {
          await expect(initialize()).revertedWith('L1b');
        });
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(initialize()).revertedWith('M2');
      });

      it('should revert when MatrixToken is not in pending state', async function () {
        const newModule = await getRandomAddress();
        await systemFixture.controller.addModule(newModule);
        const newToken = await systemFixture.createMatrixToken([systemFixture.weth.address], [ethToWei(1)], [newModule], owner);
        matrixTokenAddress = newToken.address;
        await expect(initialize()).revertedWith('M5b');
      });

      it('should revert when the MatrixToken is not enabled on the controller', async function () {
        const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);

        matrixTokenAddress = nonEnabledToken.address;
        await expect(initialize()).revertedWith('M5a');
      });
    });

    describe('when isAllowed is false', function () {
      beforeEach(async function () {
        isAllowed = false;
        await initContracts();
        initVariables();
      });

      it('should revert when MatrixToken is not allowlisted', async function () {
        await expect(initialize()).revertedWith('L1a');
      });

      it('should enable the Module on the MatrixToken when any Matrix can initialize this module', async function () {
        await aaveLeverageModule.updateAnyMatrixAllowed(true);
        await initialize();
        const isModuleEnabled = await matrixToken.isInitializedModule(aaveLeverageModule.address);
        expect(isModuleEnabled).is.true;
      });
    });
  });

  describe('lever', function () {
    const destTokenQuantity = ethToWei(1);
    const minCollateralQuantity = ethToWei(1);

    let caller;
    let tradeData; // Bytes
    let matrixToken;
    let borrowAsset;
    let notInitialized;
    let collateralAsset;
    let borrowQuantity;
    let tradeAdapterName;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    context('when aWETH is collateral asset and borrow positions is 0', async function () {
      async function initContracts() {
        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address],
          [ethToWei(2)],
          [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true); // Add MatrixToken to allow list

        if (notInitialized) {
          const collateralAssets = [systemFixture.weth.address, systemFixture.dai.address];
          const borrowAssets = [systemFixture.dai.address, systemFixture.weth.address];
          await aaveLeverageModule.initialize(matrixToken.address, collateralAssets, borrowAssets);
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of Matrix supply
        await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);
      }

      function initVariables() {
        caller = owner;
        matrixTokenAddress = matrixToken.address;
        borrowAsset = systemFixture.dai.address;
        collateralAsset = systemFixture.weth.address;
        borrowQuantity = ethToWei(1000);
        tradeAdapterName = 'ONE_INCH_TO_WETH';

        tradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
          systemFixture.dai.address, // Send token
          systemFixture.weth.address, // Receive token
          borrowQuantity, // Send quantity
          minCollateralQuantity, // Min receive quantity
          ZERO,
          ZERO_ADDRESS,
          [ZERO_ADDRESS],
          EMPTY_BYTES,
          [ZERO],
          [ZERO],
        ]);
      }

      async function lever() {
        return aaveLeverageModule
          .connect(caller)
          .lever(matrixTokenAddress, borrowAsset, collateralAsset, borrowQuantity, minCollateralQuantity, tradeAdapterName, tradeData);
      }

      describe('when module is initialized', function () {
        beforeEach(async function () {
          notInitialized = true;
          await initContracts();
          initVariables();
        });

        it('should update the collateral position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          await lever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2); // added a new borrow position

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.positionState).eq(0); // Default
          expect(newFirstPosition.component).eq(aWETH.address);
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);

          const expectedFirstPositionUnit = oldPositions[0].unit.add(destTokenQuantity);
          expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
        });

        it('should update the borrow position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          await lever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.positionState).eq(1); // External
          expect(newSecondPosition.component).eq(systemFixture.dai.address);
          expect(newSecondPosition.module).eq(aaveLeverageModule.address);

          const expectedSecondPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
          expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
        });

        it('should transfer the correct components to the exchange', async function () {
          const oldSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
          await lever();
          const newSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
          expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(borrowQuantity);
        });

        it('should transfer the correct components from the exchange', async function () {
          const oldDestTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockToWeth.address);
          await lever();
          const newDestTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockToWeth.address);
          expect(oldDestTokenBalance.sub(newDestTokenBalance)).eq(destTokenQuantity);
        });

        it('should revert when the exchange is not valid', async function () {
          tradeAdapterName = 'INVALID_EXCHANGE';
          await expect(lever()).revertedWith('M0');
        });

        it('should revert when collateral asset is not enabled', async function () {
          collateralAsset = systemFixture.wbtc.address;
          await expect(lever()).revertedWith('L11a');
        });

        it('should revert when borrow asset is not enabled', async function () {
          borrowAsset = await getRandomAddress();
          await expect(lever()).revertedWith('L11b');
        });

        it('should revert when borrow asset is same as collateral asset', async function () {
          borrowAsset = systemFixture.weth.address;
          await expect(lever()).revertedWith('L11c');
        });

        it('should revert when quantity of token to sell is 0', async function () {
          borrowQuantity = ZERO;
          await expect(lever()).revertedWith('L11d');
        });

        it('should revert when the caller is not the MatrixToken manager', async function () {
          caller = randomAccount;
          await expect(lever()).revertedWith('M1a');
        });

        it('should revert when MatrixToken is not valid', async function () {
          const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);
          matrixTokenAddress = nonEnabledToken.address;
          await expect(lever()).revertedWith('M1b');
        });

        describe('when the leverage position has been liquidated', function () {
          const ethSeized = ethToWei(1);

          beforeEach(async function () {
            // Lever up
            await aaveLeverageModule
              .connect(caller)
              .lever(matrixTokenAddress, borrowAsset, collateralAsset, borrowQuantity, minCollateralQuantity, tradeAdapterName, tradeData);

            // ETH decreases to $250
            const liquidationDaiPriceInEth = ethToWei(0.004); // 1/250 = 0.004
            await aaveV2Fixture.setAssetPriceInOracle(systemFixture.dai.address, liquidationDaiPriceInEth);

            // Seize 1 ETH + liquidation bonus by repaying debt of 250 DAI
            const debtToCover = ethToWei(250);
            await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(250));

            await aaveV2Fixture.lendingPool
              .connect(owner)
              .liquidationCall(systemFixture.weth.address, systemFixture.dai.address, matrixToken.address, debtToCover, true);

            // ETH increases to $1250 to allow more borrow
            await aaveV2Fixture.setAssetPriceInOracle(systemFixture.dai.address, ethToWei(0.0008)); // 1/1250 = .0008

            borrowQuantity = ethToWei(1000);
          });

          it('should transfer the correct components to the exchange', async function () {
            const oldSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
            await lever();
            const newSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
            expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(borrowQuantity);
          });

          it('should update the collateral position on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(2);

            await lever();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.positionState).eq(0); // Default
            expect(newFirstPosition.component).eq(aWETH.address);
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);

            const aaveLiquidationBonus = (await aaveV2Fixture.protocolDataProvider.getReserveConfigurationData(systemFixture.weth.address)).liquidationBonus;
            const liquidatedEth = preciseDiv(preciseMul(ethSeized, aaveLiquidationBonus), BigNumber.from(10000)); // ethSeized * 105%
            const expectedPostLiquidationUnit = oldPositions[0].unit.sub(liquidatedEth).add(destTokenQuantity);
            expect(newFirstPosition.unit).eq(expectedPostLiquidationUnit);
          });

          it('should update the borrow position on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(2);

            await lever();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.positionState).eq(1); // External
            expect(newSecondPosition.component).eq(systemFixture.dai.address);
            expect(newSecondPosition.module).eq(aaveLeverageModule.address);

            const expectedSecondPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
            expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
          });
        });

        describe('when there is a protocol fee charged', function () {
          const feePercentage = ethToWei(0.05);

          beforeEach(async function () {
            await systemFixture.controller.connect(owner).addFee(
              aaveLeverageModule.address,
              ZERO, // Fee type on trade function denoted as 0
              feePercentage // 5%
            );
          });

          it('should transfer the correct components to the exchange', async function () {
            const oldSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
            await lever();
            const newSrcTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockToWeth.address);
            expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(borrowQuantity);
          });

          it('should transfer the correct protocol fee to the protocol', async function () {
            const oldFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);
            await lever();
            const newFeeRecipientBalance = await systemFixture.weth.balanceOf(protocolFeeRecipientAddress);

            expect(newFeeRecipientBalance.sub(oldFeeRecipientBalance)).eq(preciseMul(destTokenQuantity, feePercentage));
          });

          it('should update the collateral position on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);

            await lever();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.positionState).eq(0); // Default
            expect(newFirstPosition.component).eq(aWETH.address);
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);

            const unitProtocolFee = destTokenQuantity.mul(feePercentage).div(ethToWei(1));
            const newUnits = destTokenQuantity.sub(unitProtocolFee);
            const expectedFirstPositionUnit = oldPositions[0].unit.add(newUnits);
            expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
          });

          it('should update the borrow position on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);

            await lever();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.positionState).eq(1); // External
            expect(newSecondPosition.component).eq(systemFixture.dai.address);
            expect(newSecondPosition.module).eq(aaveLeverageModule.address);

            const expectedSecondPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
            expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
          });

          it('should emit the correct IncreaseLeverage event', async function () {
            const totalBorrowQuantity = borrowQuantity;
            const totalCollateralQuantity = destTokenQuantity;
            const totalProtocolFee = feePercentage.mul(totalCollateralQuantity).div(ethToWei(1));

            await expect(lever())
              .emit(aaveLeverageModule, 'IncreaseLeverage')
              .withArgs(
                matrixToken.address,
                borrowAsset,
                collateralAsset,
                oneInchExchangeAdapterToWeth.address,
                totalBorrowQuantity,
                totalCollateralQuantity.sub(totalProtocolFee),
                totalProtocolFee
              );
          });
        });

        it('should revert when slippage is greater than allowed', async function () {
          // Add MatrixToken as token sender / recipient
          await oneInchExchangeMockWithSlippage.connect(owner).addMatrixTokenAddress(matrixToken.address);

          // Fund One Inch exchange with destinationToken WETH
          await systemFixture.weth.transfer(oneInchExchangeMockWithSlippage.address, ethToWei(10));

          // other mock exchange adapter with slippage
          tradeAdapterName = 'ONE_INCH_SLIPPAGE';

          tradeData = oneInchExchangeMockWithSlippage.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            borrowQuantity, // Send quantity
            minCollateralQuantity, // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await expect(lever()).revertedWith('L10');
        });
      });

      describe('when module is not initialized', function () {
        beforeEach(async function () {
          notInitialized = false;
          await initContracts();
          initVariables();
        });

        it('should revert when module is not initialized', async function () {
          await expect(lever()).revertedWith('M1b');
        });
      });
    });

    context('when DAI is borrow asset, and is a default position', async function () {
      beforeEach(async function () {
        notInitialized = true;

        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address, systemFixture.dai.address],
          [ethToWei(2), ethToWei(1)],
          [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true); // Add MatrixToken to allow list

        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.dai.address],
            [systemFixture.dai.address, systemFixture.weth.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);
        await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(10000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.dai.address, ethToWei(10000), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));
        await aDAI.approve(systemFixture.basicIssuanceModule.address, ethToWei(10000));

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);
      });

      beforeEach(function () {
        caller = owner;
        borrowQuantity = ethToWei(1000);
        tradeAdapterName = 'ONE_INCH_TO_WETH';
        borrowAsset = systemFixture.dai.address;
        matrixTokenAddress = matrixToken.address;
        collateralAsset = systemFixture.weth.address;

        tradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
          systemFixture.dai.address, // Send token
          systemFixture.weth.address, // Receive token
          borrowQuantity, // Send quantity
          minCollateralQuantity, // Min receive quantity
          ZERO,
          ZERO_ADDRESS,
          [ZERO_ADDRESS],
          EMPTY_BYTES,
          [ZERO],
          [ZERO],
        ]);
      });

      async function lever() {
        return aaveLeverageModule
          .connect(caller)
          .lever(matrixTokenAddress, borrowAsset, collateralAsset, borrowQuantity, minCollateralQuantity, tradeAdapterName, tradeData);
      }

      it('should update the collateral position on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await lever();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(3);

        const newFirstPosition = newPositions[0];
        expect(newFirstPosition.positionState).eq(0); // Default
        expect(newFirstPosition.component).eq(aWETH.address);
        expect(newFirstPosition.module).eq(ZERO_ADDRESS);
        const expectedFirstPositionUnit = oldPositions[0].unit.add(destTokenQuantity);
        expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);

        const newSecondPosition = newPositions[1];
        expect(newSecondPosition.positionState).eq(0); // Default
        expect(newSecondPosition.component).eq(systemFixture.dai.address);
        expect(newSecondPosition.module).eq(ZERO_ADDRESS);
        expect(newSecondPosition.unit).eq(ethToWei(1));
      });

      it('should update the borrow position on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await lever();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(3);

        const newThridPosition = newPositions[2];
        expect(newThridPosition.positionState).eq(1); // External
        expect(newThridPosition.component).eq(systemFixture.dai.address);
        expect(newThridPosition.module).eq(aaveLeverageModule.address);

        const expectedPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
        expect(newThridPosition.unit).eq(expectedPositionUnit);
      });
    });
  });

  describe('delever', function () {
    let redeemQuantity;

    let caller;
    let tradeData; // Bytes
    let repayAsset;
    let matrixToken;
    let notInitialized;
    let collateralAsset;
    let tradeAdapterName;
    let minRepayQuantity;
    let destTokenQuantity;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(2)],
        [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(
          matrixToken.address,
          [systemFixture.weth.address, systemFixture.dai.address],
          [systemFixture.dai.address, systemFixture.weth.address]
        );
      }
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      // Add MatrixToken as token sender / recipient
      await oneInchExchangeMockToWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

      // Fund One Inch exchange with destinationToken WETH
      await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

      // Add MatrixToken as token sender / recipient
      await oneInchExchangeMockFromWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

      // Fund One Inch exchange with destinationToken DAI
      await systemFixture.weth.transfer(oneInchExchangeAdapterToWeth.address, ethToWei(100));
      await systemFixture.dai.transfer(oneInchExchangeMockFromWeth.address, ethToWei(10000));

      // Mint aTokens
      await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
      await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

      // Approve tokens to issuance module and call issue
      await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

      // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

      // Lever MatrixToken
      if (notInitialized) {
        const leverTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
          systemFixture.dai.address, // Send token
          systemFixture.weth.address, // Receive token
          ethToWei(1000), // Send quantity
          ethToWei(1), // Min receive quantity
          ZERO,
          ZERO_ADDRESS,
          [ZERO_ADDRESS],
          EMPTY_BYTES,
          [ZERO],
          [ZERO],
        ]);

        await aaveLeverageModule.lever(
          matrixToken.address,
          systemFixture.dai.address,
          systemFixture.weth.address,
          ethToWei(1000),
          ethToWei(1),
          'ONE_INCH_TO_WETH',
          leverTradeData
        );
      }

      destTokenQuantity = ethToWei(1000);
    }

    function initVariables() {
      caller = owner;
      redeemQuantity = ethToWei(1);
      minRepayQuantity = destTokenQuantity;
      repayAsset = systemFixture.dai.address;
      tradeAdapterName = 'ONE_INCH_FROM_WETH';
      matrixTokenAddress = matrixToken.address;
      collateralAsset = systemFixture.weth.address;

      tradeData = oneInchExchangeMockFromWeth.interface.encodeFunctionData('swap', [
        systemFixture.weth.address, // Send token
        systemFixture.dai.address, // Receive token
        redeemQuantity, // Send quantity
        minRepayQuantity, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);
    }

    async function delever() {
      return aaveLeverageModule
        .connect(caller)
        .delever(matrixTokenAddress, collateralAsset, repayAsset, redeemQuantity, minRepayQuantity, tradeAdapterName, tradeData);
    }

    describe('when module is initialized', function () {
      beforeEach(async function () {
        notInitialized = true;
        await initContracts();
        initVariables();
      });

      it('should update the collateral position on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await delever();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(2);

        const newFirstPosition = newPositions[0];
        expect(newFirstPosition.positionState).eq(0); // Default
        expect(newFirstPosition.component).eq(aWETH.address);
        expect(newFirstPosition.module).eq(ZERO_ADDRESS);

        const expectedFirstPositionUnit = oldPositions[0].unit.sub(redeemQuantity);
        expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
      });

      it('should update the borrow position on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await delever();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(2);

        const newSecondPosition = newPositions[1];
        expect(newSecondPosition.positionState).eq(1); // External
        expect(newSecondPosition.component).eq(systemFixture.dai.address);
        expect(newSecondPosition.module).eq(aaveLeverageModule.address);

        const expectedSecondPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
        expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
      });

      it('should transfer the correct components to the exchange', async function () {
        const oldSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
        await delever();
        const newSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
        expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(redeemQuantity);
      });

      it('should transfer the correct components from the exchange', async function () {
        const oldDestTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockFromWeth.address);
        await delever();
        const newDestTokenBalance = await systemFixture.dai.balanceOf(oneInchExchangeMockFromWeth.address);
        expect(oldDestTokenBalance.sub(newDestTokenBalance)).eq(destTokenQuantity);
      });

      it('should revert when the exchange is not valid', async function () {
        tradeAdapterName = 'INVALID_EXCHANGE';
        await expect(delever()).revertedWith('M0');
      });

      it('should revert when quantity of token to sell is 0', async function () {
        redeemQuantity = ZERO;
        await expect(delever()).revertedWith('L11d');
      });

      it('should revert when borrow / repay asset is not enabled', async function () {
        repayAsset = systemFixture.wbtc.address;
        await expect(delever()).revertedWith('L11b');
      });

      it('should revert when collateral asset is not enabled', async function () {
        collateralAsset = await getRandomAddress();
        await expect(delever()).revertedWith('L11a');
      });

      it('should revert when borrow asset is same as collateral asset', async function () {
        repayAsset = systemFixture.weth.address;
        await expect(delever()).revertedWith('L11c');
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(delever()).revertedWith('M1a');
      });

      it('should revert when MatrixToken is not valid', async function () {
        const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);
        matrixTokenAddress = nonEnabledToken.address;
        await expect(delever()).revertedWith('M1b');
      });

      describe('when there is a protocol fee charged', function () {
        let feePercentage;

        beforeEach(async function () {
          feePercentage = ethToWei(0.05);
          await systemFixture.controller.connect(owner).addFee(
            aaveLeverageModule.address,
            ZERO, // Fee type on trade function denoted as 0
            feePercentage // 5%
          );
        });

        it('should transfer the correct components to the exchange', async function () {
          const oldSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
          await delever();
          const newSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
          expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(redeemQuantity);
        });

        it('should transfer the correct protocol fee to the protocol', async function () {
          const oldFeeRecipientBalance = await systemFixture.dai.balanceOf(protocolFeeRecipientAddress);
          await delever();
          const newFeeRecipientBalance = await systemFixture.dai.balanceOf(protocolFeeRecipientAddress);
          expect(newFeeRecipientBalance.sub(oldFeeRecipientBalance)).eq(preciseMul(feePercentage, destTokenQuantity));
        });

        it('should update the collateral position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(2);

          await delever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.positionState).eq(0); // Default
          expect(newFirstPosition.component).eq(aWETH.address);
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);

          const expectedFirstPositionUnit = oldPositions[0].unit.sub(redeemQuantity);
          expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
        });

        it('should update the borrow position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(2);

          await delever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.positionState).eq(1); // External
          expect(newSecondPosition.component).eq(systemFixture.dai.address);
          expect(newSecondPosition.module).eq(aaveLeverageModule.address);

          const expectedSecondPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
          expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
        });

        it('should emit the correct DecreaseLeverage event', async function () {
          const totalRepayQuantity = destTokenQuantity;
          const totalProtocolFee = feePercentage.mul(totalRepayQuantity).div(ethToWei(1));

          await expect(delever())
            .emit(aaveLeverageModule, 'DecreaseLeverage')
            .withArgs(
              matrixToken.address,
              collateralAsset,
              repayAsset,
              oneInchExchangeAdapterFromWeth.address,
              redeemQuantity,
              totalRepayQuantity.sub(totalProtocolFee),
              totalProtocolFee
            );
        });
      });

      describe('when used to delever to zero', function () {
        beforeEach(async function () {
          minRepayQuantity = ethToWei(1001);
          await oneInchExchangeMockFromWeth.updateReceiveAmount(minRepayQuantity);

          tradeData = oneInchExchangeMockFromWeth.interface.encodeFunctionData('swap', [
            systemFixture.weth.address, // Send token
            systemFixture.dai.address, // Receive token
            redeemQuantity, // Send quantity
            minRepayQuantity, // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);
        });

        it('should transfer the correct components to the exchange', async function () {
          const oldSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
          await delever();
          const newSrcTokenBalance = await systemFixture.weth.balanceOf(oneInchExchangeMockFromWeth.address);
          expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(redeemQuantity);
        });

        it('should update the collateral position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(2);

          await delever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.positionState).eq(0); // Default
          expect(newFirstPosition.component).eq(aWETH.address);
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);

          const expectedFirstPositionUnit = oldPositions[0].unit.sub(redeemQuantity);
          expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
        });

        it('should update the borrow position on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(2);

          await delever();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.positionState).eq(0); // Default since we traded for more Dai than outstannding debt
          expect(newSecondPosition.component).eq(systemFixture.dai.address);
          expect(newSecondPosition.module).eq(ZERO_ADDRESS);

          const expectedSecondPositionUnit = await systemFixture.dai.balanceOf(matrixToken.address);
          expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
        });

        it('should emit the correct DecreaseLeverage event', async function () {
          await expect(delever())
            .emit(aaveLeverageModule, 'DecreaseLeverage')
            .withArgs(matrixToken.address, collateralAsset, repayAsset, oneInchExchangeAdapterFromWeth.address, redeemQuantity, minRepayQuantity, ZERO);
        });
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        initVariables();
      });

      it('should revert when module is not initialized', async function () {
        await expect(delever()).revertedWith('M1b');
      });
    });
  });

  describe('deleverToZeroBorrowBalance', function () {
    const uniswapFixture = new UniswapFixture(owner);

    let caller;
    let tradeData; // Bytes
    let repayAsset;
    let matrixToken;
    let notInitialized;
    let redeemQuantity;
    let collateralAsset;
    let tradeAdapterName;
    let matrixTokenAddress;
    let uniswapV2ExchangeAdapterV2;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(10)],
        [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(
          matrixToken.address,
          [systemFixture.weth.address, systemFixture.dai.address],
          [systemFixture.dai.address, systemFixture.weth.address]
        );
      }
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      // Add MatrixToken as token sender / recipient
      await oneInchExchangeMockToWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

      // Fund One Inch exchange with destinationToken WETH
      await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(1));

      // Setup uniswap
      await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
      uniswapV2ExchangeAdapterV2 = await deployContract('UniswapV2ExchangeAdapterV2', [uniswapFixture.router.address], owner);

      // Add integration
      await systemFixture.integrationRegistry.addIntegration(aaveLeverageModule.address, 'UNISWAP_V2_ADAPTER_V2', uniswapV2ExchangeAdapterV2.address);

      // Add liquidity
      await systemFixture.weth.approve(uniswapFixture.router.address, ethToWei(500));
      await systemFixture.dai.approve(uniswapFixture.router.address, ethToWei(500000));

      await uniswapFixture.router.addLiquidity(
        systemFixture.weth.address,
        systemFixture.dai.address,
        ethToWei(500),
        ethToWei(500000),
        ethToWei(499),
        ethToWei(499000),
        owner.address,
        MAX_UINT_256
      );

      // Mint aTokens
      await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(10));
      await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(10), owner.address, ZERO);

      // Approve tokens to issuance module and call issue
      await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(10));

      // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

      // Lever MatrixToken
      if (notInitialized) {
        const leverTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
          systemFixture.dai.address, // Send token
          systemFixture.weth.address, // Receive token
          ethToWei(1000), // Send quantity
          ethToWei(1), // Min receive quantity
          ZERO,
          ZERO_ADDRESS,
          [ZERO_ADDRESS],
          EMPTY_BYTES,
          [ZERO],
          [ZERO],
        ]);

        await aaveLeverageModule.lever(
          matrixToken.address,
          systemFixture.dai.address,
          systemFixture.weth.address,
          ethToWei(1000),
          ethToWei(1),
          'ONE_INCH_TO_WETH',
          leverTradeData
        );
      }
    }

    async function initVariables() {
      caller = owner;
      redeemQuantity = ethToWei(2);
      repayAsset = systemFixture.dai.address;
      matrixTokenAddress = matrixToken.address;
      tradeAdapterName = 'UNISWAP_V2_ADAPTER_V2';
      collateralAsset = systemFixture.weth.address;
      tradeData = await uniswapV2ExchangeAdapterV2.generateDataParam(systemFixture.weth.address, systemFixture.dai.address, true); // fixed_input
    }

    async function deleverToZeroBorrowBalance() {
      return await aaveLeverageModule
        .connect(caller)
        .deleverToZeroBorrowBalance(matrixTokenAddress, collateralAsset, repayAsset, redeemQuantity, tradeAdapterName, tradeData);
    }

    describe('when module is initialized', function () {
      beforeEach(async function () {
        notInitialized = true;
        await initContracts();
        await initVariables();
      });

      it('should update the collateral position on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await deleverToZeroBorrowBalance();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(2);

        const newFirstPosition = newPositions[0];
        expect(newFirstPosition.positionState).eq(0); // Default
        expect(newFirstPosition.component).eq(aWETH.address);
        expect(newFirstPosition.module).eq(ZERO_ADDRESS);

        const expectedFirstPositionUnit = oldPositions[0].unit.sub(redeemQuantity);
        expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);
      });

      it('should wipe the debt on Aave', async function () {
        await deleverToZeroBorrowBalance();
        const borrowDebt = await variableDebtDAI.balanceOf(matrixToken.address);
        expect(borrowDebt).eq(ZERO);
      });

      it('should remove external positions on the borrow asset', async function () {
        await deleverToZeroBorrowBalance();

        const borrowAssetExternalModules = await matrixToken.getExternalPositionModules(systemFixture.dai.address);
        const isPositionModule = await matrixToken.isExternalPositionModule(systemFixture.dai.address, aaveLeverageModule.address);
        const borrowExternalUnit = await matrixToken.getExternalPositionRealUnit(systemFixture.dai.address, aaveLeverageModule.address);

        expect(borrowAssetExternalModules).is.empty;
        expect(borrowExternalUnit).eq(ZERO);
        expect(isPositionModule).is.false;
      });

      it('should update the borrow asset equity on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        const [, repayAssetAmountOut] = await uniswapFixture.router.getAmountsOut(redeemQuantity, [systemFixture.weth.address, systemFixture.dai.address]);

        const tx = await deleverToZeroBorrowBalance();

        // Fetch total repay amount
        const res = await tx.wait();
        const decreaseLeverageEvent = res.events?.find(function (value) {
          return value.event == 'DecreaseLeverage';
        });
        const totalRepayAmount = decreaseLeverageEvent?.args?.[5];

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(2);

        const newSecondPosition = newPositions[1];
        expect(newSecondPosition.positionState).eq(0); // Default
        expect(newSecondPosition.component).eq(systemFixture.dai.address);
        expect(newSecondPosition.module).eq(ZERO_ADDRESS);

        const expectedSecondPositionUnit = repayAssetAmountOut.sub(totalRepayAmount);
        expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
      });

      it('should transfer the correct components to the exchange', async function () {
        const oldSrcTokenBalance = await systemFixture.weth.balanceOf(uniswapFixture.wethDaiPool.address);
        await deleverToZeroBorrowBalance();
        const newSrcTokenBalance = await systemFixture.weth.balanceOf(uniswapFixture.wethDaiPool.address);
        expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(redeemQuantity);
      });

      it('should transfer the correct components from the exchange', async function () {
        const [, repayAssetAmountOut] = await uniswapFixture.router.getAmountsOut(redeemQuantity, [systemFixture.weth.address, systemFixture.dai.address]);

        const oldDestTokenBalance = await systemFixture.dai.balanceOf(uniswapFixture.wethDaiPool.address);
        await deleverToZeroBorrowBalance();
        const newDestTokenBalance = await systemFixture.dai.balanceOf(uniswapFixture.wethDaiPool.address);

        expect(oldDestTokenBalance.sub(newDestTokenBalance)).eq(repayAssetAmountOut);
      });

      it('should revert when the exchange is not valid', async function () {
        tradeAdapterName = 'INVALID_EXCHANGE';
        await expect(deleverToZeroBorrowBalance()).revertedWith('M0');
      });

      it('should revert when borrow / repay asset is not enabled', async function () {
        repayAsset = systemFixture.wbtc.address;
        await expect(deleverToZeroBorrowBalance()).revertedWith('L0a');
      });

      it('should revert when borrow balance is 0', async function () {
        await aaveLeverageModule.connect(owner).addBorrowAssets(matrixToken.address, [systemFixture.wbtc.address]);
        repayAsset = systemFixture.wbtc.address;
        await expect(deleverToZeroBorrowBalance()).revertedWith('L0b');
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(deleverToZeroBorrowBalance()).revertedWith('M1a');
      });

      it('should revert when MatrixToken is not valid', async function () {
        const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);
        matrixTokenAddress = nonEnabledToken.address;
        await expect(deleverToZeroBorrowBalance()).revertedWith('M1b');
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        await initVariables();
      });

      it('should revert when module is not initialized', async function () {
        await expect(deleverToZeroBorrowBalance()).revertedWith('M1b');
      });
    });
  });

  describe('sync', function () {
    let caller;
    let matrixToken;
    let notInitialized;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    function initVariables() {
      caller = randomAccount;
      matrixTokenAddress = matrixToken.address;
    }

    async function sync() {
      return aaveLeverageModule.connect(caller).sync(matrixTokenAddress);
    }

    context('when aWETH and aDAI are collateral and WETH and DAI are borrow assets', async function () {
      const initContracts = async function () {
        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address, aDAI.address],
          [ethToWei(2), ethToWei(1000)],
          [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);
        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        // Initialize module if set to true
        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.dai.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
            [systemFixture.dai.address, systemFixture.weth.address, systemFixture.wbtc.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);
        await oneInchExchangeMockFromWeth.addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH and DAI
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));
        await systemFixture.dai.transfer(oneInchExchangeMockFromWeth.address, ethToWei(10000));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);
        await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(10000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.dai.address, ethToWei(10000), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));
        await aDAI.approve(systemFixture.basicIssuanceModule.address, ethToWei(10000));

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

        if (notInitialized) {
          // Leverage aWETH in MatrixToken
          const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            ethToWei(1000), // Send quantity
            ethToWei(1), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            ethToWei(1000),
            ethToWei(1),
            'ONE_INCH_TO_WETH',
            leverEthTradeData
          );

          // Leverage DAI in MatrixToken
          const leverDaiTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.weth.address, // Send token
            systemFixture.dai.address, // Receive token
            ethToWei(1), // Send quantity
            ethToWei(1000), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.weth.address,
            systemFixture.dai.address,
            ethToWei(1),
            ethToWei(1000),
            'ONE_INCH_FROM_WETH',
            leverDaiTradeData
          );
        }
      };

      describe('when module is initialized', function () {
        beforeEach(async function () {
          notInitialized = true;
          await initContracts();
          initVariables();
        });

        it('should update the collateral positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(4);

          await sync();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(4);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.positionState).eq(0); // Default
          expect(newFirstPosition.component).eq(aWETH.address);
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);

          const expectedFirstPositionUnit = await aWETH.balanceOf(matrixToken.address); // need not divide as total supply is 1.
          expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.positionState).eq(0); // Default
          expect(newSecondPosition.component).eq(aDAI.address);
          expect(newSecondPosition.module).eq(ZERO_ADDRESS);

          const expectedSecondPositionUnit = await aDAI.balanceOf(matrixToken.address);
          expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
        });

        it('should update the borrow positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(4);

          await sync();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(4);

          const newThirdPosition = newPositions[2];
          expect(newThirdPosition.positionState).eq(1); // External
          expect(newThirdPosition.component).eq(systemFixture.dai.address);
          expect(newThirdPosition.module).eq(aaveLeverageModule.address);

          const expectedThirdPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
          expect(newThirdPosition.unit).eq(expectedThirdPositionUnit);

          const newFourthPosition = newPositions[3];
          expect(newFourthPosition.positionState).eq(1); // External
          expect(newFourthPosition.component).eq(systemFixture.weth.address);
          expect(newFourthPosition.module).eq(aaveLeverageModule.address);

          const expectedFourthPositionUnit = (await variableDebtWETH.balanceOf(matrixToken.address)).mul(-1);
          expect(newFourthPosition.unit).eq(expectedFourthPositionUnit);
        });

        describe('when leverage position has been liquidated', function () {
          let liquidationRepayQuantity;

          beforeEach(async function () {
            // Leverage aWETH again
            const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
              systemFixture.dai.address, // Send token
              systemFixture.weth.address, // Receive token
              ethToWei(1000), // Send quantity
              ethToWei(1), // Min receive quantity
              ZERO,
              ZERO_ADDRESS,
              [ZERO_ADDRESS],
              EMPTY_BYTES,
              [ZERO],
              [ZERO],
            ]);

            await aaveLeverageModule.lever(
              matrixToken.address,
              systemFixture.dai.address,
              systemFixture.weth.address,
              ethToWei(1000),
              ethToWei(1),
              'ONE_INCH_TO_WETH',
              leverEthTradeData
            );
          });

          beforeEach(async function () {
            // ETH decreases to $100
            const liquidationDaiPriceInEth = ethToWei(0.01); // 1/100 = 0.01
            await aaveV2Fixture.setAssetPriceInOracle(systemFixture.dai.address, liquidationDaiPriceInEth);

            // Seize 1 ETH + 5% liquidation bonus by repaying debt of 100 DAI
            liquidationRepayQuantity = ethToWei(100);
            await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(100));

            await aaveV2Fixture.lendingPool
              .connect(owner)
              .liquidationCall(systemFixture.weth.address, systemFixture.dai.address, matrixToken.address, liquidationRepayQuantity, true);
          });

          it('should update the collateral positions on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(4);

            await sync();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(4);

            // aWETH position decreases
            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.positionState).eq(0); // Default
            expect(newFirstPosition.component).eq(aWETH.address);
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);

            const expectedFirstPositionUnit = await aWETH.balanceOf(matrixToken.address);
            expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);

            // cDAI position should stay the same
            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.positionState).eq(0); // Default
            expect(newSecondPosition.component).eq(aDAI.address);
            expect(newSecondPosition.module).eq(ZERO_ADDRESS);
          });

          it('should update the borrow position on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(4);

            await sync();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(4);

            const newThirdPosition = newPositions[2];
            expect(newThirdPosition.positionState).eq(1); // External
            expect(newThirdPosition.component).eq(systemFixture.dai.address);
            expect(newThirdPosition.module).eq(aaveLeverageModule.address);

            const expectedThirdPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1);
            expect(newThirdPosition.unit).eq(expectedThirdPositionUnit);

            const newFourthPosition = newPositions[3];
            expect(newFourthPosition.positionState).eq(1); // External
            expect(newFourthPosition.component).eq(systemFixture.weth.address);
            expect(newFourthPosition.module).eq(aaveLeverageModule.address);

            const expectedFourthPositionUnit = (await variableDebtWETH.balanceOf(matrixToken.address)).mul(-1);
            expect(newFourthPosition.unit).eq(expectedFourthPositionUnit);
          });
        });

        it('should revert when MatrixToken is not valid', async function () {
          const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);
          matrixTokenAddress = nonEnabledToken.address;
          await expect(sync()).revertedWith('M3');
        });
      });

      describe('when module is not initialized', function () {
        it('should revert when module is not initialized', async function () {
          notInitialized = false;
          await expect(sync()).revertedWith('M3');
        });
      });
    });

    describe('when MatrixToken total supply is 0', function () {
      async function initContracts() {
        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address, aDAI.address],
          [ethToWei(2), ethToWei(1000)],
          [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        await aaveLeverageModule.initialize(
          matrixToken.address,
          [systemFixture.weth.address, systemFixture.dai.address],
          [systemFixture.dai.address, systemFixture.weth.address]
        );
      }

      beforeEach(async function () {
        await initContracts();
        initVariables();
      });

      it('should preserve default positions', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(2);

        await sync();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(2); // 2 Default positions

        expect(newPositions[0].positionState).eq(0); // Default
        expect(newPositions[0].component).eq(aWETH.address);
        expect(newPositions[0].module).eq(ZERO_ADDRESS);
        expect(newPositions[0].unit).eq(oldPositions[0].unit);

        expect(newPositions[1].positionState).eq(0); // Default
        expect(newPositions[1].component).eq(aDAI.address);
        expect(newPositions[1].module).eq(ZERO_ADDRESS);
        expect(newPositions[1].unit).eq(oldPositions[1].unit);
      });
    });
  });

  describe('addCollateralAssets', function () {
    let caller;
    let matrixToken;
    let notInitialized;
    let collateralAssets;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(1)],
        [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(matrixToken.address, [systemFixture.weth.address], []);
      }
    }

    function initVariables() {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
      collateralAssets = [systemFixture.dai.address];
    }

    async function addCollateralAssets() {
      return aaveLeverageModule.connect(caller).addCollateralAssets(matrixTokenAddress, collateralAssets);
    }

    describe('when module is initialized', function () {
      beforeEach(async function () {
        notInitialized = true;
        await initContracts();
        initVariables();
      });

      it('should add the collateral asset to mappings', async function () {
        await addCollateralAssets();
        const realCollateralAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[0];
        const isDaiCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.dai.address);

        expect(JSON.stringify(realCollateralAssets)).eq(JSON.stringify([systemFixture.weth.address, systemFixture.dai.address]));
        expect(isDaiCollateral).is.true;
      });

      it('should emit the correct UpdateCollateralAssets event', async function () {
        await expect(addCollateralAssets()).emit(aaveLeverageModule, 'UpdateCollateralAssets').withArgs(matrixTokenAddress, true, collateralAssets);
      });

      context('before first issuance, aToken balance is zero', async function () {
        it('should not be able to enable collateral asset to be used as collateral on Aave', async function () {
          const oldUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.dai.address, matrixToken.address);
          expect(oldUserReserveData.usageAsCollateralEnabled).is.false;

          await addCollateralAssets();

          const newUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.dai.address, matrixToken.address);
          expect(newUserReserveData.usageAsCollateralEnabled).is.false;
        });
      });

      describe('when re-adding a removed collateral asset', function () {
        beforeEach(async function () {
          // Mint aTokens
          await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
          await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

          // Approve tokens to issuance module and call issue
          await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

          // Transfer of aToken to MatrixToken during issuance would enable the underlying to be used as collateral by MatrixToken on Aave
          await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
          await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

          // Now remove collateral asset to disable underlying to be used as collateral on Aave
          await aaveLeverageModule.removeCollateralAssets(matrixToken.address, [systemFixture.weth.address]);

          collateralAssets = [systemFixture.weth.address]; // re-add weth
        });

        it('should re-enable asset to be used as collateral on Aave', async function () {
          const oldUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.weth.address, matrixToken.address);
          expect(oldUserReserveData.usageAsCollateralEnabled).is.false;

          await addCollateralAssets();

          const newUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.weth.address, matrixToken.address);
          expect(newUserReserveData.usageAsCollateralEnabled).is.true;
        });
      });

      it('should revert when collateral asset is duplicated', async function () {
        collateralAssets = [systemFixture.weth.address, systemFixture.weth.address];
        await expect(addCollateralAssets()).revertedWith('L12a');
      });

      describe('when a new Aave reserve is added as collateral', function () {
        beforeEach(async function () {
          // Create a new reserve
          await aaveV2Fixture.createAndEnableReserve(
            systemFixture.usdc.address,
            'USDC',
            8,
            8000, // base LTV: 80%
            8250, // liquidation threshold: 82.5%
            10500, // liquidation bonus: 105.00%
            1000, // reserve factor: 10%
            true, // enable borrowing on reserve
            true // enable stable debts
          );

          collateralAssets = [systemFixture.usdc.address];
        });

        it('should revert when a new Aave reserve is added as collateral', async function () {
          await expect(addCollateralAssets()).revertedWith('L12b');
        });

        it('should add collateral asset to mappings when updateUnderlyingToReserveTokenMappings is called before', async function () {
          await aaveLeverageModule.addUnderlyingToReserveTokensMapping(systemFixture.usdc.address);
          await addCollateralAssets();
          const realCollateralAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[0];
          const isUsdcCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.usdc.address);

          expect(JSON.stringify(realCollateralAssets)).eq(JSON.stringify([systemFixture.weth.address, systemFixture.usdc.address]));
          expect(isUsdcCollateral).is.true;
        });
      });

      it('should revert when collateral asset does not exist on Aave', async function () {
        collateralAssets = [await getRandomAddress()];
        await expect(addCollateralAssets()).revertedWith('L12c');
      });

      describe('when collateral asset reserve is frozen on Aave', function () {
        beforeEach(async function () {
          await aaveV2Fixture.lendingPoolConfigurator.connect(owner).freezeReserve(systemFixture.dai.address);
        });

        afterEach(async function () {
          await aaveV2Fixture.lendingPoolConfigurator.connect(owner).unfreezeReserve(systemFixture.dai.address);
        });

        it('should revert when collateral asset reserve is frozen on Aave', async function () {
          await expect(addCollateralAssets()).revertedWith('L12d');
        });
      });

      it('should revert when LTV is zero and asset can not be used as collateral', async function () {
        await aaveV2Fixture.createAndEnableReserve(
          systemFixture.usdc.address,
          'USDC',
          BigNumber.from(18),
          ZERO, // base LTV: 0%
          ZERO, // liquidation threshold: 0%
          ZERO, // liquidation bonus: 105.00%
          BigNumber.from(1000), // reserve factor: 10%
          true, // enable borrowing on reserve
          false // enable stable debts
        );

        await aaveLeverageModule.addUnderlyingToReserveTokensMapping(systemFixture.usdc.address);

        collateralAssets = [systemFixture.usdc.address];
        await expect(addCollateralAssets()).revertedWith('L12e');
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(addCollateralAssets()).revertedWith('M1a');
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        initVariables();
      });

      it('should revert when module is not initialized', async function () {
        await expect(addCollateralAssets()).revertedWith('M1b');
      });
    });
  });

  describe('addBorrowAssets', function () {
    let caller;
    let matrixToken;
    let borrowAssets;
    let notInitialized;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [systemFixture.weth.address, systemFixture.dai.address],
        [ethToWei(1), ethToWei(100)],
        [aaveLeverageModule.address, debtIssuanceMock.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(matrixToken.address, [], [systemFixture.weth.address]);
      }
    }

    function initVariables() {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
      borrowAssets = [systemFixture.dai.address];
    }

    async function addBorrowAssets() {
      return aaveLeverageModule.connect(caller).addBorrowAssets(matrixTokenAddress, borrowAssets);
    }

    describe('when module is initialized', function () {
      beforeEach(async function () {
        notInitialized = true;
        await initContracts();
        initVariables();
      });

      it('should add the borrow asset to mappings', async function () {
        await addBorrowAssets();
        const realBorrowAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[1];
        const isDAIBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.dai.address);

        expect(JSON.stringify(realBorrowAssets)).eq(JSON.stringify([systemFixture.weth.address, systemFixture.dai.address]));
        expect(isDAIBorrow).is.true;
      });

      it('should emit the correct UpdateBorrowAssets event', async function () {
        await expect(addBorrowAssets()).emit(aaveLeverageModule, 'UpdateBorrowAssets').withArgs(matrixTokenAddress, true, borrowAssets);
      });

      it('should revert when borrow asset is duplicated', async function () {
        borrowAssets = [systemFixture.dai.address, systemFixture.dai.address];
        await expect(addBorrowAssets()).revertedWith('L13a');
      });

      it('should revert when borrow asset reserve does not exist on Aave', async function () {
        borrowAssets = [await getRandomAddress()];
        await expect(addBorrowAssets()).revertedWith('L13c');
      });

      it('should revert when borrowing is disabled for an asset on Aave', async function () {
        await aaveV2Fixture.createAndEnableReserve(
          systemFixture.usdc.address,
          'USDC',
          BigNumber.from(6),
          BigNumber.from(8000),
          BigNumber.from(8200),
          BigNumber.from(10500),
          BigNumber.from(1000),
          false,
          false
        );
        await aaveLeverageModule.addUnderlyingToReserveTokensMapping(systemFixture.usdc.address);
        borrowAssets = [systemFixture.dai.address, systemFixture.usdc.address];

        await expect(addBorrowAssets()).revertedWith('L13e');
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(addBorrowAssets()).revertedWith('M1a');
      });

      describe('when borrow asset reserve is frozen on Aave', function () {
        beforeEach(async function () {
          await aaveV2Fixture.lendingPoolConfigurator.connect(owner).freezeReserve(systemFixture.dai.address);
        });

        afterEach(async function () {
          await aaveV2Fixture.lendingPoolConfigurator.connect(owner).unfreezeReserve(systemFixture.dai.address);
        });

        it('should revert', async function () {
          await expect(addBorrowAssets()).revertedWith('L13d');
        });
      });

      describe('when a new Aave reserve is added as borrow', function () {
        beforeEach(async function () {
          // Create a new reserve
          await aaveV2Fixture.createAndEnableReserve(
            systemFixture.usdc.address,
            'USDC',
            BigNumber.from(8),
            BigNumber.from(8000), // base LTV: 80%
            BigNumber.from(8250), // liquidation threshold: 82.5%
            BigNumber.from(10500), // liquidation bonus: 105.00%
            BigNumber.from(1000), // reserve factor: 10%
            true, // enable borrowing on reserve
            true // enable stable debts
          );

          borrowAssets = [systemFixture.usdc.address];
        });

        it('should revert when a new Aave reserve is added as borrow', async function () {
          await expect(addBorrowAssets()).revertedWith('L13b');
        });

        it('should add collateral asset to mappings when updateUnderlyingToReserveTokenMappings is called before', async function () {
          await aaveLeverageModule.addUnderlyingToReserveTokensMapping(systemFixture.usdc.address);
          await addBorrowAssets();
          const realBorrowAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[1];
          const isUsdcBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.usdc.address);

          expect(JSON.stringify(realBorrowAssets)).eq(JSON.stringify([systemFixture.weth.address, systemFixture.usdc.address]));
          expect(isUsdcBorrow).is.true;
        });
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        await initVariables();
      });

      it('should revert', async function () {
        await expect(addBorrowAssets()).revertedWith('M1b');
      });
    });
  });

  describe('registerToModule', function () {
    let matrixToken;
    let notInitialized;
    let matrixTokenAddress;
    let otherIssuanceModule; // DebtIssuanceMock
    let subjectDebtIssuanceModule;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      otherIssuanceModule = await deployContract('DebtIssuanceMock', [], owner);
      await systemFixture.controller.addModule(otherIssuanceModule.address);

      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(100)],
        [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(
          matrixToken.address,
          [systemFixture.weth.address, systemFixture.dai.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
          [systemFixture.dai.address, systemFixture.weth.address, systemFixture.wbtc.address]
        );
      }
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      // Add other issuance mock after initializing Aave Leverage module, so register is never called
      await matrixToken.addModule(otherIssuanceModule.address);
      await otherIssuanceModule.initialize(matrixToken.address);
    }

    function initVariables() {
      matrixTokenAddress = matrixToken.address;
      subjectDebtIssuanceModule = otherIssuanceModule.address;
    }

    async function registerToModule() {
      return aaveLeverageModule.registerToModule(matrixTokenAddress, subjectDebtIssuanceModule);
    }

    describe('when module is initialized', function () {
      beforeEach(async function () {
        notInitialized = true;
        await initContracts();
        initVariables();
      });

      it('should register on the other issuance module', async function () {
        expect(await otherIssuanceModule.isRegistered(matrixToken.address)).is.false;
        await registerToModule();
        expect(await otherIssuanceModule.isRegistered(matrixToken.address)).is.true;
      });

      it('should revert when MatrixToken is not valid', async function () {
        const nonEnabledToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [aaveLeverageModule.address], owner);
        matrixTokenAddress = nonEnabledToken.address;
        await expect(registerToModule()).revertedWith('M1b');
      });

      it('should revert when debt issuance module is not initialized on MatrixToken', async function () {
        await matrixToken.removeModule(otherIssuanceModule.address);
        await expect(registerToModule()).revertedWith('L3');
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        initVariables();
      });

      it('should revert', async function () {
        await expect(registerToModule()).revertedWith('M1b');
      });
    });
  });

  describe('moduleIssueHook', function () {
    let caller;
    let matrixToken;
    let notInitialized;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
      revertBlockchain(snapshotId);
    });

    context('when aWETH and aDAI are collateral and WETH and DAI are borrow assets', async function () {
      before(async function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        // Add mock module to controller
        await systemFixture.controller.addModule(mockModule.address);

        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address, aDAI.address],
          [ethToWei(10), ethToWei(5000)],
          [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.dai.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
            [systemFixture.dai.address, systemFixture.weth.address, systemFixture.wbtc.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Initialize mock module
        await matrixToken.addModule(mockModule.address);
        await matrixToken.connect(mockModule).initializeModule();

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);
        await oneInchExchangeMockFromWeth.addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH and DAI
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));
        await systemFixture.dai.transfer(oneInchExchangeMockFromWeth.address, ethToWei(10000));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(10));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(10), owner.address, ZERO);
        await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(10000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.dai.address, ethToWei(10000), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(10));
        await aDAI.approve(systemFixture.basicIssuanceModule.address, ethToWei(10000));

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

        // Lever both aDAI and aWETH in MatrixToken
        if (notInitialized) {
          const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            ethToWei(1000), // Send quantity
            ethToWei(1), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            ethToWei(1000),
            ethToWei(1),
            'ONE_INCH_TO_WETH',
            leverEthTradeData
          );

          const leverDaiTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.weth.address, // Send token
            systemFixture.dai.address, // Receive token
            ethToWei(1), // Send quantity
            ethToWei(1000), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.weth.address,
            systemFixture.dai.address,
            ethToWei(1),
            ethToWei(1000),
            'ONE_INCH_FROM_WETH',
            leverDaiTradeData
          );
        }

        caller = mockModule;
        matrixTokenAddress = matrixToken.address;
      });

      async function moduleIssueHook() {
        return aaveLeverageModule.connect(caller).moduleIssueHook(matrixTokenAddress, ZERO);
      }

      it('should update the collateral positions on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(4);

        await moduleIssueHook();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(4);

        const newFirstPosition = newPositions[0];
        expect(newFirstPosition.positionState).eq(0); // Default
        expect(newFirstPosition.component).eq(aWETH.address);
        expect(newFirstPosition.module).eq(ZERO_ADDRESS);
        const expectedFirstPositionUnit = await aWETH.balanceOf(matrixToken.address); // need not divide, since total Supply = 1
        expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);

        const newSecondPosition = newPositions[1];
        expect(newSecondPosition.positionState).eq(0); // Default
        expect(newSecondPosition.component).eq(aDAI.address);
        expect(newSecondPosition.module).eq(ZERO_ADDRESS);
        const expectedSecondPositionUnit = await aDAI.balanceOf(matrixToken.address);
        expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
      });

      it('should update the borrow positions on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(4);

        await moduleIssueHook();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(4);

        const newThirdPosition = newPositions[2];
        expect(newThirdPosition.positionState).eq(1); // External
        expect(newThirdPosition.component).eq(systemFixture.dai.address);
        expect(newThirdPosition.module).eq(aaveLeverageModule.address);
        const expectedThirdPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1); // since, variable debt mode
        expect(newThirdPosition.unit).eq(expectedThirdPositionUnit);

        const newFourthPosition = newPositions[3];
        expect(newFourthPosition.positionState).eq(1); // External
        expect(newFourthPosition.component).eq(systemFixture.weth.address);
        expect(newFourthPosition.module).eq(aaveLeverageModule.address);
        const expectedFourthPositionUnit = (await variableDebtWETH.balanceOf(matrixToken.address)).mul(-1);
        expect(newFourthPosition.unit).eq(expectedFourthPositionUnit);
      });

      it('should revert when caller is not module', async function () {
        caller = owner;
        await expect(moduleIssueHook()).revertedWith('M4a');
      });

      it('should revert if disabled module is caller', async function () {
        await systemFixture.controller.removeModule(mockModule.address);
        await expect(moduleIssueHook()).revertedWith('M4b');
      });
    });
  });

  describe('moduleRedeemHook', function () {
    let caller;
    let matrixToken;
    let notInitialized;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    context('when aWETH and aDAI are collateral and WETH and DAI are borrow assets', async function () {
      before(async function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        // Add mock module to controller
        await systemFixture.controller.addModule(mockModule.address);

        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address, aDAI.address],
          [ethToWei(10), ethToWei(5000)],
          [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.dai.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
            [systemFixture.dai.address, systemFixture.weth.address, systemFixture.wbtc.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Initialize mock module
        await matrixToken.addModule(mockModule.address);
        await matrixToken.connect(mockModule).initializeModule();

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);
        await oneInchExchangeMockFromWeth.addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH and DAI
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));
        await systemFixture.dai.transfer(oneInchExchangeMockFromWeth.address, ethToWei(10000));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(10));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(10), owner.address, ZERO);
        await systemFixture.dai.approve(aaveV2Fixture.lendingPool.address, ethToWei(10000));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.dai.address, ethToWei(10000), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(10));
        await aDAI.approve(systemFixture.basicIssuanceModule.address, ethToWei(10000));

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

        // Lever both aDAI and aWETH in MatrixToken
        if (notInitialized) {
          const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            ethToWei(1000), // Send quantity
            ethToWei(1), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            ethToWei(1000),
            ethToWei(1),
            'ONE_INCH_TO_WETH',
            leverEthTradeData
          );

          const leverDaiTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.weth.address, // Send token
            systemFixture.dai.address, // Receive token
            ethToWei(1), // Send quantity
            ethToWei(1000), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.weth.address,
            systemFixture.dai.address,
            ethToWei(1),
            ethToWei(1000),
            'ONE_INCH_FROM_WETH',
            leverDaiTradeData
          );
        }

        caller = mockModule;
        matrixTokenAddress = matrixToken.address;
      });

      async function moduleRedeemHook() {
        return aaveLeverageModule.connect(caller).moduleRedeemHook(matrixTokenAddress, ZERO);
      }

      it('should update the collateral positions on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(4);

        await moduleRedeemHook();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(4);

        const newFirstPosition = newPositions[0];
        expect(newFirstPosition.positionState).eq(0); // Default
        expect(newFirstPosition.component).eq(aWETH.address);
        expect(newFirstPosition.module).eq(ZERO_ADDRESS);
        const expectedFirstPositionUnit = await aWETH.balanceOf(matrixToken.address); // need not divide, since total Supply = 1
        expect(newFirstPosition.unit).eq(expectedFirstPositionUnit);

        const newSecondPosition = newPositions[1];
        expect(newSecondPosition.positionState).eq(0); // Default
        expect(newSecondPosition.component).eq(aDAI.address);
        expect(newSecondPosition.module).eq(ZERO_ADDRESS);
        const expectedSecondPositionUnit = await aDAI.balanceOf(matrixToken.address);
        expect(newSecondPosition.unit).eq(expectedSecondPositionUnit);
      });

      it('should update the borrow positions on the MatrixToken correctly', async function () {
        const oldPositions = await matrixToken.getPositions();
        expect(oldPositions.length).eq(4);

        await moduleRedeemHook();

        const newPositions = await matrixToken.getPositions();
        expect(newPositions.length).eq(4);

        const newThirdPosition = newPositions[2];
        expect(newThirdPosition.positionState).eq(1); // External
        expect(newThirdPosition.component).eq(systemFixture.dai.address);
        expect(newThirdPosition.module).eq(aaveLeverageModule.address);
        const expectedThirdPositionUnit = (await variableDebtDAI.balanceOf(matrixToken.address)).mul(-1); // since, variable debt mode
        expect(newThirdPosition.unit).eq(expectedThirdPositionUnit);

        const newFourthPosition = newPositions[3];
        expect(newFourthPosition.positionState).eq(1); // External
        expect(newFourthPosition.component).eq(systemFixture.weth.address);
        expect(newFourthPosition.module).eq(aaveLeverageModule.address);
        const expectedFourthPositionUnit = (await variableDebtWETH.balanceOf(matrixToken.address)).mul(-1);
        expect(newFourthPosition.unit).eq(expectedFourthPositionUnit);
      });

      it('should revert when caller is not module', async function () {
        caller = owner;
        await expect(moduleRedeemHook()).revertedWith('M4a');
      });

      it('should revert if disabled module is caller', async function () {
        await systemFixture.controller.removeModule(mockModule.address);
        await expect(moduleRedeemHook()).revertedWith('M4b');
      });
    });
  });

  describe('componentIssueHook', function () {
    const issueQuantity = ethToWei(1);

    let caller;
    let isEquity;
    let component;
    let matrixToken;
    let notInitialized;
    let borrowQuantity;
    let matrixTokenAddress;
    let matrixTokenQuantity;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    context('when aWETH is collateral and DAI is borrow asset', async function () {
      before(async function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        // Add mock module to controller
        await systemFixture.controller.addModule(mockModule.address);

        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address],
          [ethToWei(2)],
          [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);
        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.dai.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
            [systemFixture.dai.address, systemFixture.weth.address, systemFixture.wbtc.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
        // Initialize mock module
        await matrixToken.addModule(mockModule.address);
        await matrixToken.connect(mockModule).initializeModule();

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH and DAI
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(100));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(100), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.connect(owner).approve(systemFixture.basicIssuanceModule.address, ethToWei(100));

        await systemFixture.basicIssuanceModule.issue(matrixToken.address, issueQuantity, owner.address);

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        borrowQuantity = ethToWei(1000);
        if (notInitialized) {
          // Lever cETH in MatrixToken
          const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            borrowQuantity, // Send quantity
            ethToWei(0.9), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            borrowQuantity,
            ethToWei(0.9),
            'ONE_INCH_TO_WETH',
            leverEthTradeData
          );
        }

        isEquity = false;
        caller = mockModule;
        matrixTokenQuantity = issueQuantity;
        component = systemFixture.dai.address;
        matrixTokenAddress = matrixToken.address;
      });

      async function componentIssueHook() {
        return aaveLeverageModule.connect(caller).componentIssueHook(matrixTokenAddress, matrixTokenQuantity, component, isEquity);
      }

      it('should increase borrowed quantity on the MatrixToken', async function () {
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(ZERO);
        await componentIssueHook();
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(preciseMul(borrowQuantity, matrixTokenQuantity));
      });

      it('should revert when isEquity is false and component has positive unit (should not happen)', async function () {
        component = aWETH.address;
        await expect(componentIssueHook()).revertedWith('L8');
      });

      it('should NOT increase borrowed quantity on the MatrixToken when isEquity is true', async function () {
        isEquity = true;
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(ZERO);
        await componentIssueHook();
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(ZERO);
      });

      it('should revert when caller is not module', async function () {
        caller = owner;
        await expect(componentIssueHook()).revertedWith('M4a');
      });

      it('should revert if disabled module is caller', async function () {
        await systemFixture.controller.removeModule(mockModule.address);
        await expect(componentIssueHook()).revertedWith('M4b');
      });
    });
  });

  describe('componentRedeemHook', function () {
    const issueQuantity = ethToWei(1);

    let caller;
    let isEquity;
    let component;
    let matrixToken;
    let repayQuantity;
    let notInitialized;
    let matrixTokenAddress;
    let matrixTokenQuantity;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    context('when aWETH is collateral and DAI is borrow asset', async function () {
      before(async function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        // Add mock module to controller
        await systemFixture.controller.addModule(mockModule.address);

        matrixToken = await systemFixture.createMatrixToken(
          [aWETH.address],
          [ethToWei(2)],
          [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
          owner
        );
        await debtIssuanceMock.initialize(matrixToken.address);

        // Add MatrixToken to allow list
        await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

        if (notInitialized) {
          await aaveLeverageModule.initialize(
            matrixToken.address,
            [systemFixture.weth.address, systemFixture.wbtc.address], // Enable WBTC that is not a position
            [systemFixture.dai.address, systemFixture.wbtc.address]
          );
        }
        await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

        // Initialize mock module
        await matrixToken.addModule(mockModule.address);
        await matrixToken.connect(mockModule).initializeModule();

        // Add MatrixToken as token sender / recipient
        await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);

        // Fund One Inch exchange with destinationToken WETH and DAI
        await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

        // Mint aTokens
        await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(100));
        await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(100), owner.address, ZERO);

        // Approve tokens to issuance module and call issue
        await aWETH.connect(owner).approve(systemFixture.basicIssuanceModule.address, ethToWei(100));

        await systemFixture.basicIssuanceModule.issue(matrixToken.address, issueQuantity, owner.address);

        // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
        repayQuantity = ethToWei(1000);

        // Lever aETH in MatrixToken
        if (notInitialized) {
          const leverEthTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            repayQuantity, // Send quantity
            ethToWei(0.1), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            repayQuantity,
            ethToWei(0.1),
            'ONE_INCH_TO_WETH',
            leverEthTradeData
          );
        }

        // Transfer repay quantity to MatrixToken for repayment
        await systemFixture.dai.transfer(matrixToken.address, repayQuantity);

        isEquity = false;
        caller = mockModule;
        matrixTokenQuantity = issueQuantity;
        matrixTokenAddress = matrixToken.address;
        component = systemFixture.dai.address;
      });

      async function componentRedeemHook() {
        return aaveLeverageModule.connect(caller).componentRedeemHook(matrixTokenAddress, matrixTokenQuantity, component, isEquity);
      }

      it('should decrease borrowed quantity on the MatrixToken', async function () {
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(repayQuantity);
        await componentRedeemHook();
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(ZERO);
      });

      it('should revert when _isEquity is false and component has positive unit', async function () {
        component = aWETH.address;
        await expect(componentRedeemHook()).revertedWith('L9');
      });

      it('should NOT decrease borrowed quantity on the MatrixToken when isEquity is true', async function () {
        isEquity = true;
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(repayQuantity);
        await componentRedeemHook();
        expect(await systemFixture.dai.balanceOf(matrixToken.address)).eq(repayQuantity);
      });

      it('should revert when caller is not module', async function () {
        caller = owner;
        await expect(componentRedeemHook()).revertedWith('M4a');
      });

      it('should revert if disabled module is caller', async function () {
        await systemFixture.controller.removeModule(mockModule.address);
        await expect(componentRedeemHook()).revertedWith('M4b');
      });
    });
  });

  describe('removeModule', function () {
    let module;
    let matrixToken;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(100)],
        [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);
      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);
      await aaveLeverageModule.initialize(matrixToken.address, [systemFixture.weth.address], [systemFixture.weth.address, systemFixture.dai.address]);
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      // Mint aTokens
      await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
      await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

      // Approve tokens to issuance module and call issue
      await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

      module = aaveLeverageModule.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function removeModule() {
      return matrixToken.removeModule(module);
    }

    it('should remove the Module on the MatrixToken', async function () {
      await removeModule();
      const isModuleEnabled = await matrixToken.isInitializedModule(aaveLeverageModule.address);
      expect(isModuleEnabled).is.false;
    });

    it('should delete the mappings', async function () {
      await removeModule();

      const realCollateralAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[0];
      const realBorrowAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[1];
      const isWethCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.weth.address);
      const isDaiCollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.weth.address);
      const isDaiBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.weth.address);
      const isEtherBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.weth.address);

      expect(realCollateralAssets).is.empty;
      expect(realBorrowAssets).is.empty;
      expect(isWethCollateral).is.false;
      expect(isDaiCollateral).is.false;
      expect(isDaiBorrow).is.false;
      expect(isEtherBorrow).is.false;
    });

    it('should unregister on the debt issuance module', async function () {
      await removeModule();
      expect(await debtIssuanceMock.isRegistered(matrixToken.address)).is.false;
    });

    it('should revert when borrow balance exists', async function () {
      // Add MatrixToken as token sender / recipient
      oneInchExchangeMockToWeth = oneInchExchangeMockToWeth.connect(owner);
      await oneInchExchangeMockToWeth.addMatrixTokenAddress(matrixToken.address);

      // Fund One Inch exchange with destinationToken WETH
      await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

      // Lever MatrixToken
      const leverTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
        systemFixture.dai.address, // Send token
        systemFixture.weth.address, // Receive token
        ethToWei(1000), // Send quantity
        ethToWei(1), // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);

      await aaveLeverageModule.lever(
        matrixToken.address,
        systemFixture.dai.address,
        systemFixture.weth.address,
        ethToWei(1000),
        ethToWei(1),
        'ONE_INCH_TO_WETH',
        leverTradeData
      );

      await expect(removeModule()).revertedWith('L2');
    });
  });

  describe('removeCollateralAssets', function () {
    let caller;
    let matrixToken;
    let notInitialized;
    let collateralAssets;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(1)],
        [aaveLeverageModule.address, debtIssuanceMock.address, systemFixture.basicIssuanceModule.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);

      if (notInitialized) {
        await aaveLeverageModule.initialize(matrixToken.address, [systemFixture.weth.address, systemFixture.dai.address], []);
      }
    }

    function initVariables() {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
      collateralAssets = [systemFixture.dai.address];
    }

    async function removeCollateralAssets() {
      return await aaveLeverageModule.connect(caller).removeCollateralAssets(matrixTokenAddress, collateralAssets);
    }

    describe('when module is initialized', function () {
      before(async function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        await initContracts();
        initVariables();
      });

      it('should remove the collateral asset from mappings', async function () {
        await removeCollateralAssets();
        const realCollateralAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[0];
        const isDAICollateral = await aaveLeverageModule.isEnabledCollateralAsset(matrixToken.address, systemFixture.dai.address);
        expect(JSON.stringify(realCollateralAssets)).eq(JSON.stringify([systemFixture.weth.address]));
        expect(isDAICollateral).is.false;
      });

      it('should emit the correct UpdateCollateralAssets event', async function () {
        await expect(removeCollateralAssets()).emit(aaveLeverageModule, 'UpdateCollateralAssets').withArgs(matrixTokenAddress, false, collateralAssets);
      });

      it('should revert when collateral asset is not enabled on module', async function () {
        collateralAssets = [systemFixture.weth.address, systemFixture.usdc.address];
        await expect(removeCollateralAssets()).revertedWith('L5');
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(removeCollateralAssets()).revertedWith('M1a');
      });

      describe('when removing a collateral asset which has been enabled to be used as collateral on aave', function () {
        beforeEach(async function () {
          // Mint aTokens
          await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
          await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

          // Approve tokens to issuance module and call issue
          await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

          // Transfer of aToken to MatrixToken during issuance would enable the underlying to be used as collateral by MatrixToken on Aave
          await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);
          await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

          collateralAssets = [systemFixture.weth.address]; // remove weth
        });

        it('should disable the asset to be used as collateral on aave', async function () {
          const oldUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.weth.address, matrixToken.address);
          expect(oldUserReserveData.usageAsCollateralEnabled).is.true;

          await removeCollateralAssets();

          const newUserReserveData = await aaveV2Fixture.protocolDataProvider.getUserReserveData(systemFixture.weth.address, matrixToken.address);
          expect(newUserReserveData.usageAsCollateralEnabled).is.false;
        });
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        initVariables();
      });

      it('should revert', async function () {
        await expect(removeCollateralAssets()).revertedWith('M1b');
      });
    });
  });

  describe('removeBorrowAssets', function () {
    let caller;
    let matrixToken;
    let borrowAssets;
    let notInitialized;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function initContracts() {
      matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(2)],
        [aaveLeverageModule.address, systemFixture.basicIssuanceModule.address, debtIssuanceMock.address],
        owner
      );
      await debtIssuanceMock.initialize(matrixToken.address);

      // Add MatrixToken to allow list
      await aaveLeverageModule.updateAllowedMatrixToken(matrixToken.address, true);
      await systemFixture.basicIssuanceModule.initialize(matrixToken.address, ZERO_ADDRESS);

      // Mint aTokens
      await systemFixture.weth.approve(aaveV2Fixture.lendingPool.address, ethToWei(1000));
      await aaveV2Fixture.lendingPool.connect(owner).deposit(systemFixture.weth.address, ethToWei(1000), owner.address, ZERO);

      // Approve tokens to issuance module and call issue
      await aWETH.approve(systemFixture.basicIssuanceModule.address, ethToWei(1000));

      // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1000 DAI regardless of MatrixToken supply
      await systemFixture.basicIssuanceModule.issue(matrixToken.address, ethToWei(1), owner.address);

      if (notInitialized) {
        await aaveLeverageModule.initialize(matrixToken.address, [systemFixture.weth.address], [systemFixture.weth.address, systemFixture.dai.address]);
      }
    }

    function initVariables() {
      caller = owner;
      matrixTokenAddress = matrixToken.address;
      borrowAssets = [systemFixture.dai.address];
    }

    async function removeBorrowAssets() {
      return aaveLeverageModule.connect(caller).removeBorrowAssets(matrixTokenAddress, borrowAssets);
    }

    describe('when module is initialized', function () {
      before(function () {
        notInitialized = true;
      });

      beforeEach(async function () {
        await initContracts();
        initVariables();
      });

      it('should remove the borrow asset from mappings', async function () {
        await removeBorrowAssets();
        const realBorrowAssets = (await aaveLeverageModule.getEnabledAssets(matrixToken.address))[1];
        const isDAIBorrow = await aaveLeverageModule.isEnabledBorrowAsset(matrixToken.address, systemFixture.dai.address);
        expect(JSON.stringify(realBorrowAssets)).eq(JSON.stringify([systemFixture.weth.address]));
        expect(isDAIBorrow).is.false;
      });

      it('should emit the correct UpdateBorrowAssets event', async function () {
        await expect(removeBorrowAssets()).emit(aaveLeverageModule, 'UpdateBorrowAssets').withArgs(matrixTokenAddress, false, borrowAssets);
      });

      it('should revert when borrow asset is not enabled on module', async function () {
        borrowAssets = [systemFixture.dai.address, systemFixture.dai.address];
        await expect(removeBorrowAssets()).revertedWith('L6a');
      });

      describe('when borrow balance exists', function () {
        beforeEach(async function () {
          // Add MatrixToken as token sender / recipient
          await oneInchExchangeMockToWeth.connect(owner).addMatrixTokenAddress(matrixToken.address);

          // Fund One Inch exchange with destinationToken WETH
          await systemFixture.weth.transfer(oneInchExchangeMockToWeth.address, ethToWei(10));

          // Lever MatrixToken
          const leverTradeData = oneInchExchangeMockToWeth.interface.encodeFunctionData('swap', [
            systemFixture.dai.address, // Send token
            systemFixture.weth.address, // Receive token
            ethToWei(1000), // Send quantity
            ethToWei(1), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await aaveLeverageModule.lever(
            matrixToken.address,
            systemFixture.dai.address,
            systemFixture.weth.address,
            ethToWei(1000),
            ethToWei(1),
            'ONE_INCH_TO_WETH',
            leverTradeData
          );
        });

        it('should revert when borrow balance exists', async function () {
          await expect(removeBorrowAssets()).revertedWith('L6b');
        });
      });

      it('should revert when the caller is not the MatrixToken manager', async function () {
        caller = randomAccount;
        await expect(removeBorrowAssets()).revertedWith('M1a');
      });
    });

    describe('when module is not initialized', function () {
      beforeEach(async function () {
        notInitialized = false;
        await initContracts();
        initVariables();
      });

      it('should revert when module is not initialized', async function () {
        await expect(removeBorrowAssets()).revertedWith('M1b');
      });
    });
  });

  describe('updateAllowedMatrixToken', function () {
    let caller;
    let status;
    let matrixToken;
    let matrixTokenAddress;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      matrixToken = matrixToken = await systemFixture.createMatrixToken(
        [aWETH.address],
        [ethToWei(2)],
        [aaveLeverageModule.address, debtIssuanceMock.address],
        owner
      );

      status = true;
      caller = owner;
      matrixTokenAddress = matrixToken.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function updateAllowedMatrixToken() {
      return aaveLeverageModule.connect(caller).updateAllowedMatrixToken(matrixTokenAddress, status);
    }

    it('should add MatrixToken to allow list', async function () {
      await updateAllowedMatrixToken();
      expect(await aaveLeverageModule.isAllowedMatrixToken(matrixTokenAddress)).is.true;
    });

    it('should emit the correct UpdateMatrixTokenStatus event', async function () {
      await expect(updateAllowedMatrixToken()).emit(aaveLeverageModule, 'UpdateMatrixTokenStatus').withArgs(matrixTokenAddress, status);
    });

    describe('when disabling a MatrixToken', function () {
      beforeEach(async function () {
        await updateAllowedMatrixToken();
        status = false;
      });

      it('should remove MatrixToken from allow list', async function () {
        await updateAllowedMatrixToken();
        expect(await aaveLeverageModule.isAllowedMatrixToken(matrixTokenAddress)).is.false;
      });

      it('should emit the correct UpdateMatrixTokenStatus event', async function () {
        await expect(updateAllowedMatrixToken()).emit(aaveLeverageModule, 'UpdateMatrixTokenStatus').withArgs(matrixTokenAddress, status);
      });

      it('should remove the MatrixToken from allow list when MatrixToken is removed on controller', async function () {
        await systemFixture.controller.removeMatrix(matrixToken.address);
        await updateAllowedMatrixToken();
        expect(await aaveLeverageModule.isAllowedMatrixToken(matrixTokenAddress)).is.false;
      });
    });

    it('should revert when MatrixToken is removed on controller', async function () {
      await systemFixture.controller.removeMatrix(matrixToken.address);
      await expect(updateAllowedMatrixToken()).revertedWith('L7');
    });

    it('should revert when not called by owner', async function () {
      caller = randomAccount;
      await expect(updateAllowedMatrixToken()).revertedWith('L14');
    });
  });

  describe('updateAnyMatrixAllowed', function () {
    let caller;
    let isAnyMatrixAllowed;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      caller = owner;
      isAnyMatrixAllowed = true;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function updateAnyMatrixAllowed() {
      return aaveLeverageModule.connect(caller).updateAnyMatrixAllowed(isAnyMatrixAllowed);
    }

    it('should remove MatrixToken from allow list', async function () {
      await updateAnyMatrixAllowed();
      expect(await aaveLeverageModule.isAnyMatrixAllowed()).is.true;
    });

    it('should emit the correct UpdateAnyMatrixAllowed event', async function () {
      await expect(updateAnyMatrixAllowed()).emit(aaveLeverageModule, 'UpdateAnyMatrixAllowed').withArgs(isAnyMatrixAllowed);
    });

    it('should revert when not called by owner', async function () {
      caller = randomAccount;
      await expect(updateAnyMatrixAllowed()).revertedWith('L14');
    });
  });

  describe('addUnderlyingToReserveTokensMappings', function () {
    let caller;
    let underlying;
    let usdcReserveTokens; // ReserveTokens

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      usdcReserveTokens = await aaveV2Fixture.createAndEnableReserve(
        systemFixture.usdc.address,
        'USDC',
        BigNumber.from(8),
        BigNumber.from(8000), // base LTV: 80%
        BigNumber.from(8250), // liquidation threshold: 82.5%
        BigNumber.from(10500), // liquidation bonus: 105.00%
        BigNumber.from(1000), // reserve factor: 10%
        true, // enable borrowing on reserve
        true // enable stable debts
      );

      caller = randomAccount;
      underlying = systemFixture.usdc.address;
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    async function addUnderlyingToReserveTokensMapping() {
      return aaveLeverageModule.connect(caller).addUnderlyingToReserveTokensMapping(underlying);
    }

    it('should add the underlying to reserve tokens mappings', async function () {
      await addUnderlyingToReserveTokensMapping();

      const reserveTokens = await aaveLeverageModule.getUnderlyingToReserveTokens(systemFixture.usdc.address);
      expect(reserveTokens.aToken).eq(usdcReserveTokens.aToken.address);
      expect(reserveTokens.variableDebtToken).eq(usdcReserveTokens.variableDebtToken.address);
    });

    it('should emit UpdateReserveTokens event', async function () {
      await expect(addUnderlyingToReserveTokensMapping())
        .emit(aaveLeverageModule, 'UpdateReserveTokens')
        .withArgs(systemFixture.usdc.address, usdcReserveTokens.aToken.address, usdcReserveTokens.variableDebtToken.address);
    });

    it('should revert when mapping already exists', async function () {
      underlying = systemFixture.weth.address;
      await expect(addUnderlyingToReserveTokensMapping()).revertedWith('L4a');
    });

    it('should revert when reserve is invalid', async function () {
      underlying = await getRandomAddress();
      await expect(addUnderlyingToReserveTokensMapping()).revertedWith('L4b');
    });
  });
});
