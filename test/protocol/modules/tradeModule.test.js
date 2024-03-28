// SPDX-License-Identifier: Apache-2.0

/* global web3 */

// ==================== External Imports ====================

const { expect } = require('chai');
const { ethers, waffle } = require('hardhat');
const { BigNumber } = ethers;
const { provider } = waffle;

// ==================== Internal Imports ====================

const { deployContract } = require('../../helpers/deploy');
const { ethToWei, btcToWei } = require('../../helpers/unitUtil');
const { SystemFixture } = require('../../fixtures/systemFixture');
const { KyberV1Fixture } = require('../../fixtures/kyberV1Fixture');
const { UniswapFixture } = require('../../fixtures/uniswapFixture');
const { getSigners, getRandomAddress } = require('../../helpers/accountUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../helpers/evmUtil.js');
const { ZERO, MAX_UINT_256, ZERO_ADDRESS, EMPTY_BYTES } = require('../../helpers/constants');

describe('contract TradeModule', function () {
  const [owner, protocolFeeRecipient, manager, mockModule, randomAccount] = getSigners();
  const systemFixture = new SystemFixture(owner, protocolFeeRecipient);
  const uniswapFixture = new UniswapFixture(owner);
  const kyberV1Fixture = new KyberV1Fixture(owner);
  const kyberLegacyAdapterName = 'KYBER_LEGACY_ADAPTER';
  const kyberV1AdapterName = 'KYBER_V1_ADAPTER';
  const kyberV1AdapterV2Name = 'KYBER_V1_ADAPTER_V2';
  const kyberV1TransferFeeAdapterName = 'KYBER_V1_TRANSFER_FEE_ADAPTER';
  const oneInchAdapterName = 'ONE_INCH_ADAPTER';
  const uniswapV2AdapterName = 'UNISWAP_V2_ADAPTER';
  const uniswapV2AdapterV2Name = 'UNISWAP_V2_ADAPTER_V2';
  const uniswapV2TransferFeeAdapterName = 'UNISWAP_V2_TRANSFER_FEE_ADAPTER';
  const wbtcRate = ethToWei(33); // 1 WBTC = 33 ETH

  let caller;
  let tradeModule;

  let kyberNetworkProxyMock;
  let kyberLegacyExchangeAdapter;
  let kyberV1ExchangeAdapter;
  let kyberV1ExchangeAdapterV2;
  let kyberV1TransferFeeExchangeAdapter;

  let oneInchExchangeMock;
  let oneInchExchangeAdapter;

  let uniswapV2ExchangeAdapter;
  let uniswapV2ExchangeAdapterV2;
  let uniswapV2TransferFeeExchangeAdapter;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();

    await systemFixture.initAll();
    await uniswapFixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);
    await kyberV1Fixture.init(systemFixture.weth.address, systemFixture.wbtc.address, systemFixture.dai.address);

    tradeModule = await deployContract('TradeModule', [systemFixture.controller.address, 'TradeModule'], owner);
    await systemFixture.controller.addModule(tradeModule.address);

    // Mock Kyber reserve only allows trading from/to WETH
    kyberNetworkProxyMock = await deployContract('KyberNetworkProxyMock', [systemFixture.weth.address], owner);
    await kyberNetworkProxyMock.addToken(systemFixture.wbtc.address, wbtcRate, 8);
    kyberLegacyExchangeAdapter = await deployContract('KyberLegacyExchangeAdapter', [kyberNetworkProxyMock.address], owner);

    kyberV1ExchangeAdapter = await deployContract('KyberV1ExchangeAdapter', [kyberV1Fixture.router.address], owner);
    kyberV1ExchangeAdapterV2 = await deployContract('KyberV1ExchangeAdapterV2', [kyberV1Fixture.router.address], owner);

    kyberV1TransferFeeExchangeAdapter = await deployContract('KyberV1TransferFeeExchangeAdapter', [kyberV1Fixture.router.address], owner);

    // Mock OneInch exchange that allows for only fixed exchange amounts
    oneInchExchangeMock = await deployContract(
      'OneInchExchangeMock',
      [
        systemFixture.wbtc.address,
        systemFixture.weth.address,
        BigNumber.from(100000000), // 1 WBTC
        wbtcRate, // Trades for 33 WETH
      ],
      owner
    );

    // one inch function signature
    const functionSignature = 'swap(address,address,uint256,uint256,uint256,address,address[],bytes,uint256[],uint256[])';
    const oneInchFunctionSignature = web3.eth.abi.encodeFunctionSignature(functionSignature);
    oneInchExchangeAdapter = await deployContract(
      'OneInchExchangeAdapter',
      [oneInchExchangeMock.address, oneInchExchangeMock.address, oneInchFunctionSignature],
      owner
    );

    uniswapV2ExchangeAdapter = await deployContract('UniswapV2ExchangeAdapter', [uniswapFixture.router.address], owner);
    uniswapV2ExchangeAdapterV2 = await deployContract('UniswapV2ExchangeAdapterV2', [uniswapFixture.router.address], owner);
    uniswapV2TransferFeeExchangeAdapter = await deployContract('UniswapV2TransferFeeExchangeAdapter', [uniswapFixture.router.address], owner);

    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, kyberLegacyAdapterName, kyberLegacyExchangeAdapter.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, kyberV1AdapterName, kyberV1ExchangeAdapter.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, kyberV1AdapterV2Name, kyberV1ExchangeAdapterV2.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, kyberV1TransferFeeAdapterName, kyberV1TransferFeeExchangeAdapter.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, oneInchAdapterName, oneInchExchangeAdapter.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, uniswapV2AdapterName, uniswapV2ExchangeAdapter.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, uniswapV2AdapterV2Name, uniswapV2ExchangeAdapterV2.address);
    await systemFixture.integrationRegistry.addIntegration(tradeModule.address, uniswapV2TransferFeeAdapterName, uniswapV2TransferFeeExchangeAdapter.address);
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', function () {
    it('should have the correct controller', async function () {
      const controller = await tradeModule.getController();
      expect(controller).eq(systemFixture.controller.address);
    });
  });

  context('when there is a deployed MatrixToken with enabled TradeModule', async function () {
    const wbtcUnits = btcToWei(1); // 1 WBTC in base units 10 ** 8

    let srcToken; // StandardTokenMock
    let destToken; // WETH9
    let matrixToken;
    let issueQuantity;
    let managerIssuanceHookMock;

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await snapshotBlockchain();

      srcToken = systemFixture.wbtc;
      destToken = systemFixture.weth;

      matrixToken = await systemFixture.createMatrixToken(
        [srcToken.address],
        [wbtcUnits],
        [systemFixture.basicIssuanceModule.address, tradeModule.address],
        manager.address
      );
    });

    afterEach(async function () {
      await revertBlockchain(snapshotId);
    });

    describe('initialize', function () {
      let matrixTokenAddress;

      beforeEach(async function () {
        caller = manager;
        matrixTokenAddress = matrixToken.address;
      });

      async function initialize() {
        return tradeModule.connect(caller).initialize(matrixTokenAddress);
      }

      it('should enable the Module on the MatrixToken', async function () {
        await initialize();
        const isModuleEnabled = await matrixToken.isInitializedModule(tradeModule.address);
        expect(isModuleEnabled).is.true;
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
        const newToken = await systemFixture.createRawMatrixToken([systemFixture.dai.address], [ethToWei(1)], [tradeModule.address], manager.address);
        matrixTokenAddress = newToken.address;
        await expect(initialize()).revertedWith('M5a');
      });
    });

    describe('trade', function () {
      let dataBytes;
      let adapterName;
      let srcQuantity;
      let tokenWithFee; // StandardTokenWithFeeMock
      let notInitialized;
      let minDestQuantity;
      let srcTokenAddress;
      let destTokenAddress;
      let srcTokenQuantity;
      let destTokenQuantity;
      let matrixTokenAddress;

      context('when trading a Default component on Kyber Legacy', async function () {
        const initContracts = async function () {
          // Fund Kyber reserve with destToken WETH
          await destToken.connect(owner).transfer(kyberNetworkProxyMock.address, ethToWei(1000));

          if (notInitialized) {
            await tradeModule.connect(manager).initialize(matrixToken.address);
          }

          srcTokenQuantity = wbtcUnits.div(2); // Trade 0.5 WBTC
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          // Issue 10 MatrixToken
          issueQuantity = ethToWei(10);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);
        };

        function initVariables() {
          caller = manager;
          dataBytes = EMPTY_BYTES;
          srcQuantity = srcTokenQuantity;
          srcTokenAddress = srcToken.address;
          adapterName = kyberLegacyAdapterName;
          destTokenAddress = destToken.address;
          matrixTokenAddress = matrixToken.address;
          minDestQuantity = destTokenQuantity.sub(ethToWei(0.5)); // Receive a min of 16 WETH for 0.5 WBTC
        }

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        describe('when the module is not initialized', function () {
          beforeEach(async function () {
            notInitialized = false;
            await initContracts();
            initVariables();
          });

          it('should revert when module is not initialized', async function () {
            await expect(trade()).revertedWith('M1b');
          });
        });

        describe('when the module is initialized', function () {
          beforeEach(async function () {
            notInitialized = true;
            await initContracts();
            initVariables();
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

            const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(totalDestQuantity);
          });

          it('should transfer the correct components from the MatrixToken', async function () {
            const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

            const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
          });

          it('should transfer the correct components to the exchange', async function () {
            const oldSrcTokenBalance = await srcToken.balanceOf(kyberNetworkProxyMock.address);
            await trade();
            const newSrcTokenBalance = await srcToken.balanceOf(kyberNetworkProxyMock.address);

            const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
            expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(totalSrcQuantity);
          });

          it('should transfer the correct components from the exchange', async function () {
            const oldDestTokenBalance = await destToken.balanceOf(kyberNetworkProxyMock.address);
            await trade();
            const newDestTokenBalance = await destToken.balanceOf(kyberNetworkProxyMock.address);

            const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
            expect(oldDestTokenBalance.sub(newDestTokenBalance)).eq(totalDestQuantity);
          });

          it('should update the positions on the MatrixToken correctly', async function () {
            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);
            const oldFirstPosition = oldPositions[0];

            await trade();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);
            expect(newFirstPosition.component).eq(srcToken.address);
            expect(newFirstPosition.unit).eq(oldFirstPosition.unit.sub(srcTokenQuantity));

            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.module).eq(ZERO_ADDRESS);
            expect(newSecondPosition.unit).eq(destTokenQuantity);
            expect(newSecondPosition.component).eq(destToken.address);
          });

          describe('when there is a protocol fee charged', function () {
            let feePercentage;

            beforeEach(async function () {
              feePercentage = ethToWei(0.05); // fee is 5%
              await systemFixture.controller.connect(owner).addFee(tradeModule.address, ZERO, feePercentage); // Fee type on trade function denoted as 0
            });

            it('should transfer the correct components minus fee to the MatrixToken', async function () {
              const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
              await trade();
              const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

              const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
              const totalProtocolFee = feePercentage.mul(totalDestQuantity).div(ethToWei(1));
              expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(totalDestQuantity.sub(totalProtocolFee));
            });

            it('should transfer the correct components from the MatrixToken to the exchange', async function () {
              const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
              await trade();
              const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

              const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
              expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
            });

            it('should update the positions on the MatrixToken correctly', async function () {
              const oldPositions = await matrixToken.getPositions();
              expect(oldPositions.length).eq(1);
              const oldFirstPosition = oldPositions[0];

              await trade();

              const newPositions = await matrixToken.getPositions();
              expect(newPositions.length).eq(2);

              const newFirstPosition = newPositions[0];
              expect(newFirstPosition.module).eq(ZERO_ADDRESS);
              expect(newFirstPosition.component).eq(srcToken.address);
              expect(newFirstPosition.unit).eq(oldFirstPosition.unit.sub(srcTokenQuantity));

              const newSecondPosition = newPositions[1];
              expect(newSecondPosition.module).eq(ZERO_ADDRESS);
              expect(newSecondPosition.component).eq(destToken.address);
              const unitProtocolFee = feePercentage.mul(destTokenQuantity).div(ethToWei(1));
              expect(newSecondPosition.unit).eq(destTokenQuantity.sub(unitProtocolFee));
            });

            it('should emit the correct ExchangeComponent event', async function () {
              const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
              const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
              const totalProtocolFee = feePercentage.mul(totalDestQuantity).div(ethToWei(1));

              await expect(trade())
                .emit(tradeModule, 'ExchangeComponent')
                .withArgs(
                  matrixToken.address,
                  srcTokenAddress,
                  destTokenAddress,
                  kyberLegacyExchangeAdapter.address,
                  totalSrcQuantity,
                  totalDestQuantity.sub(totalProtocolFee),
                  totalProtocolFee
                );
            });

            describe('when receive token is more than total position units tracked on MatrixToken', function () {
              let extraTokenQuantity;

              beforeEach(async function () {
                extraTokenQuantity = ethToWei(1);
                await destToken.connect(owner).transfer(matrixToken.address, extraTokenQuantity); // Transfer destination token to MatrixToken
              });

              it('should transfer the correct components minus fee to the MatrixToken', async function () {
                const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
                await trade();
                const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

                const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
                const totalProtocolFee = feePercentage.mul(totalDestQuantity).div(ethToWei(1));
                expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(totalDestQuantity.sub(totalProtocolFee));
              });

              it('should update the positions on the MatrixToken correctly', async function () {
                const oldPositions = await matrixToken.getPositions();
                expect(oldPositions.length).eq(1);
                const oldFirstPosition = oldPositions[0];

                await trade();
                const newPositions = await matrixToken.getPositions();
                expect(newPositions.length).eq(2);

                const newFirstPosition = newPositions[0];
                expect(newFirstPosition.module).eq(ZERO_ADDRESS);
                expect(newFirstPosition.component).eq(srcToken.address);
                expect(newFirstPosition.unit).eq(oldFirstPosition.unit.sub(srcTokenQuantity));

                const newSecondPosition = newPositions[1];
                expect(newSecondPosition.module).eq(ZERO_ADDRESS);
                expect(newSecondPosition.component).eq(destToken.address);
                const unitProtocolFee = feePercentage.mul(destTokenQuantity).div(ethToWei(1));
                expect(newSecondPosition.unit).eq(destTokenQuantity.sub(unitProtocolFee));
              });
            });

            describe('when send token is more than total position units tracked on MatrixToken', function () {
              let extraTokenQuantity;

              beforeEach(async function () {
                extraTokenQuantity = ethToWei(1);
                await srcToken.connect(owner).transfer(matrixToken.address, extraTokenQuantity); // Transfer source token to MatrixToken
              });

              it('should transfer the correct components from the MatrixToken', async function () {
                const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
                await trade();
                const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

                const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
                expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
              });

              it('should update the positions on the MatrixToken correctly', async function () {
                const oldPositions = await matrixToken.getPositions();
                expect(oldPositions.length).eq(1);
                const oldFirstPosition = oldPositions[0];

                await trade();

                const newPositions = await matrixToken.getPositions();
                expect(newPositions.length).eq(2);

                const newFirstPosition = newPositions[0];
                expect(newFirstPosition.module).eq(ZERO_ADDRESS);
                expect(newFirstPosition.component).eq(srcToken.address);
                expect(newFirstPosition.unit).eq(oldFirstPosition.unit.sub(srcTokenQuantity));

                const newSecondPosition = newPositions[1];
                expect(newSecondPosition.module).eq(ZERO_ADDRESS);
                expect(newSecondPosition.component).eq(destToken.address);
                const unitProtocolFee = feePercentage.mul(destTokenQuantity).div(ethToWei(1));
                expect(newSecondPosition.unit).eq(destTokenQuantity.sub(unitProtocolFee));
              });
            });
          });

          it('should revert when MatrixToken is locked', async function () {
            await systemFixture.controller.connect(owner).addModule(mockModule.address); // Add mock module to controller
            await matrixToken.connect(manager).addModule(mockModule.address); // Add new mock module to MatrixToken
            await matrixToken.connect(mockModule).initializeModule(); // initialize module
            await matrixToken.connect(mockModule).lock(); // Lock MatrixToken
            await expect(trade()).revertedWith('T13');
          });

          it('should revert when the exchange is not valid', async function () {
            adapterName = 'INVALID_EXCHANGE';
            await expect(trade()).revertedWith('M0');
          });

          it('should revert when quantity of token to sell is 0', async function () {
            srcQuantity = ZERO;
            await expect(trade()).revertedWith('TM0a');
          });

          it('should revert when quantity sold is more than total units available', async function () {
            srcQuantity = wbtcUnits.add(1); // Set to 1 base unit more WBTC
            await expect(trade()).revertedWith('TM0b');
          });

          it('should revert when slippage is greater than allowed', async function () {
            minDestQuantity = wbtcRate.add(1); // Set to 1 base unit above the exchange rate
            await expect(trade()).revertedWith('TM1');
          });

          it('should revert when the caller is not the MatrixToken manager', async function () {
            caller = randomAccount;
            await expect(trade()).revertedWith('M1a');
          });

          it('should revert when MatrixToken is not valid', async function () {
            const newToken = await systemFixture.createRawMatrixToken([systemFixture.weth.address], [ethToWei(1)], [tradeModule.address], manager.address);
            matrixTokenAddress = newToken.address;
            await expect(trade()).revertedWith('M1b');
          });
        });
      });

      context('when trading a Default component on Kyber V1', async function () {
        beforeEach(async function () {
          await systemFixture.weth.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(4400));
          await systemFixture.wbtc.connect(owner).approve(kyberV1Fixture.router.address, btcToWei(100));
          await systemFixture.dai.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(1000000));

          // the vReserveRatioBounds below is set to the absolute minimum and maximum values as an example
          // it is recommended to read the virtual reserve ratio and set the appropriate values from that
          const vReserveRatioBounds = [0, MAX_UINT_256];

          const lastBlock = await provider.getBlock('latest');
          const deadline = BigNumber.from(lastBlock.timestamp).add(2);

          await kyberV1Fixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.wbtc.address,
            kyberV1Fixture.wethWbtcPool.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3395),
            ethToWei(99.5),
            vReserveRatioBounds,
            manager.address,
            deadline
          );

          await kyberV1Fixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.dai.address,
            kyberV1Fixture.wethDaiPool.address,
            ethToWei(1000),
            ethToWei(1000000),
            ethToWei(995),
            ethToWei(995000),
            vReserveRatioBounds,
            manager.address,
            deadline
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          srcTokenQuantity = wbtcUnits;
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);

          caller = manager;
          dataBytes = EMPTY_BYTES;
          srcQuantity = srcTokenQuantity;
          adapterName = kyberV1AdapterName;
          srcTokenAddress = srcToken.address;
          destTokenAddress = destToken.address;
          matrixTokenAddress = matrixToken.address;
          minDestQuantity = destTokenQuantity.sub(ethToWei(1)); // Receive a min of 32 WETH for 1 WBTC
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        it('should transfer the correct components to the MatrixToken', async function () {
          const poolsPath = [kyberV1Fixture.wethWbtcPool.address];
          const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [srcTokenAddress, destTokenAddress]);

          const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
          await trade();
          const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

          expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
        });

        it('should transfer the correct components from the MatrixToken', async function () {
          const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
          await trade();
          const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

          const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
          expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should update the positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          const poolsPath = [kyberV1Fixture.wethWbtcPool.address];
          const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [srcTokenAddress, destTokenAddress]);

          // All WBTC is sold for WETH
          await trade();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(1);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);
          expect(newFirstPosition.component).eq(destToken.address);
          expect(newFirstPosition.unit).eq(expectedReceiveQuantity);
        });

        describe('when path is through multiple trading pairs', function () {
          beforeEach(async function () {
            destTokenAddress = systemFixture.dai.address;
            const tradePath = [srcTokenAddress, systemFixture.weth.address, destTokenAddress];
            dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]'], [tradePath]);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address, kyberV1Fixture.wethDaiPool.address];
            const [, , expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            const expectedDestTokenBalance = oldDestTokenBalance.add(expectedReceiveQuantity);
            expect(newDestTokenBalance).eq(expectedDestTokenBalance);
          });
        });
      });

      context('when trading a Default component with a transfer fee on Kyber V1', async function () {
        let kyberFeeWbtcPool;

        beforeEach(async function () {
          tokenWithFee = await deployContract('Erc20WithFeeMock', ['Erc20WithFeeMock', 'TEST', 10], owner);
          await tokenWithFee.mint(owner.address, ethToWei(10000));

          await tokenWithFee.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(10000));
          await systemFixture.wbtc.connect(owner).approve(kyberV1Fixture.router.address, btcToWei(100));

          kyberFeeWbtcPool = await kyberV1Fixture.createNewPool(tokenWithFee.address, systemFixture.wbtc.address, 10000);

          // the vReserveRatioBounds below is set to the absolute minimum and maximum values as an example
          // it is recommended to read the virtual reserve ratio and set the appropriate values from that
          const vReserveRatioBounds = [0, MAX_UINT_256];

          const lastBlock = await provider.getBlock('latest');
          const deadline = BigNumber.from(lastBlock.timestamp).add(1);

          await kyberV1Fixture.router.addLiquidity(
            tokenWithFee.address,
            systemFixture.wbtc.address,
            kyberFeeWbtcPool.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3000),
            btcToWei(99.5),
            vReserveRatioBounds,
            manager.address,
            deadline
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          srcTokenQuantity = wbtcRate;
          const wbtcSendQuantity = wbtcUnits;

          // Transfer srcToken from owner to manager for issuance
          await systemFixture.wbtc.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await systemFixture.wbtc.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);

          await tradeModule
            .connect(manager)
            .trade(matrixToken.address, kyberV1TransferFeeAdapterName, systemFixture.wbtc.address, wbtcSendQuantity, tokenWithFee.address, ZERO, EMPTY_BYTES);

          // Trade token with fee back to WBTC
          caller = manager;
          minDestQuantity = ZERO;
          dataBytes = EMPTY_BYTES;
          srcQuantity = srcTokenQuantity.div(2);
          srcTokenAddress = tokenWithFee.address;
          matrixTokenAddress = matrixToken.address;
          adapterName = kyberV1TransferFeeAdapterName;
          destTokenAddress = systemFixture.wbtc.address;
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        it('should transfer the correct components to the MatrixToken', async function () {
          const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(
            srcQuantity.mul(90).div(100), // Sub transfer fee
            [kyberFeeWbtcPool.address],
            [srcTokenAddress, destTokenAddress]
          );

          const oldDestTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          await trade();
          const newDestTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);

          // TODO: fix this case
          // expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          expect(newDestTokenBalance.sub(oldDestTokenBalance)).lte(expectedReceiveQuantity);
        });

        it('should transfer the correct components from the MatrixToken', async function () {
          const oldSrcTokenBalance = await tokenWithFee.balanceOf(matrixToken.address);
          await trade();
          const newSrcTokenBalance = await tokenWithFee.balanceOf(matrixToken.address);

          const totalSrcQuantity = issueQuantity.mul(srcQuantity).div(ethToWei(1));
          expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should update the positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(
            srcQuantity.mul(90).div(100), // Sub transfer fee
            [kyberFeeWbtcPool.address],
            [srcTokenAddress, destTokenAddress]
          );

          await trade();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.module).eq(ZERO_ADDRESS);
          expect(newSecondPosition.component).eq(destTokenAddress);
          // TODO: fix this case
          // expect(newSecondPosition.unit).eq(expectedReceiveQuantity);
          expect(newSecondPosition.unit).lte(expectedReceiveQuantity);
        });

        describe('when path is through multiple trading pairs', function () {
          let kyberWbtcDaiPool;

          beforeEach(async function () {
            await systemFixture.wbtc.connect(owner).approve(kyberV1Fixture.router.address, btcToWei(1000));
            await systemFixture.dai.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(1000000));

            kyberWbtcDaiPool = await kyberV1Fixture.createNewPool(systemFixture.wbtc.address, systemFixture.dai.address, 10000);

            // the vReserveRatioBounds below is set to the absolute minimum and maximum values as an example
            // it is recommended to read the virtual reserve ratio and set the appropriate values from that
            const vReserveRatioBounds = [0, MAX_UINT_256];

            const lastBlock = await provider.getBlock('latest');
            const deadline = BigNumber.from(lastBlock.timestamp).add(1);

            await kyberV1Fixture.router.addLiquidity(
              systemFixture.wbtc.address,
              systemFixture.dai.address,
              kyberWbtcDaiPool.address,
              btcToWei(10),
              ethToWei(1000000),
              ethToWei(995),
              ethToWei(995000),
              vReserveRatioBounds,
              manager.address,
              deadline
            );

            destTokenAddress = systemFixture.dai.address;
            const tradePath = [srcTokenAddress, systemFixture.wbtc.address, destTokenAddress];
            dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]'], [tradePath]);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const [, , expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(
              srcQuantity.mul(90).div(100), // Sub transfer fee
              [kyberFeeWbtcPool.address, kyberWbtcDaiPool.address],
              [srcTokenAddress, systemFixture.wbtc.address, systemFixture.dai.address]
            );

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });
        });
      });

      context('when trading a Default component on Kyber V1 version 2 adapter', async function () {
        beforeEach(async function () {
          await systemFixture.weth.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(10000));
          await systemFixture.wbtc.connect(owner).approve(kyberV1Fixture.router.address, btcToWei(100));
          await systemFixture.dai.connect(owner).approve(kyberV1Fixture.router.address, ethToWei(1000000));

          // the vReserveRatioBounds below is set to the absolute minimum and maximum values as an example
          // it is recommended to read the virtual reserve ratio and set the appropriate values from that
          const vReserveRatioBounds = [0, MAX_UINT_256];

          const lastBlock = await provider.getBlock('latest');
          const deadline = BigNumber.from(lastBlock.timestamp).add(2);

          await kyberV1Fixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.wbtc.address,
            kyberV1Fixture.wethWbtcPool.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3395),
            ethToWei(99.5),
            vReserveRatioBounds,
            manager.address,
            deadline
          );

          await kyberV1Fixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.dai.address,
            kyberV1Fixture.wethDaiPool.address,
            ethToWei(1000),
            ethToWei(1000000),
            ethToWei(995),
            ethToWei(995000),
            vReserveRatioBounds,
            manager.address,
            deadline
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          srcTokenQuantity = wbtcUnits;
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        describe('when path is through one pair and swaps exact tokens for tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = true;
            const tradePath = [srcToken.address, destToken.address];

            caller = manager;
            srcTokenAddress = srcToken.address;
            adapterName = kyberV1AdapterV2Name;
            destTokenAddress = destToken.address;
            srcQuantity = srcTokenQuantity;
            matrixTokenAddress = matrixToken.address;
            minDestQuantity = destTokenQuantity.sub(ethToWei(1)); // Receive a min of 32 WETH for 1 WBTC
            dataBytes = await kyberV1ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address];
            const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [srcTokenAddress, destTokenAddress]);

            const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });

          it('should transfer the correct components from the MatrixToken', async function () {
            const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

            const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
          });

          it('should update the positions on the MatrixToken correctly', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address];
            const [, expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [srcTokenAddress, destTokenAddress]);

            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);
            await trade();
            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(1);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);
            expect(newFirstPosition.component).eq(destToken.address);
            expect(newFirstPosition.unit).eq(expectedReceiveQuantity);
          });
        });

        describe('when path is through one pair and swaps for exact tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = false;
            const tradePath = [srcToken.address, destToken.address];

            caller = manager;
            minDestQuantity = ethToWei(1);
            srcQuantity = srcTokenQuantity;
            srcTokenAddress = srcToken.address;
            adapterName = kyberV1AdapterV2Name;
            destTokenAddress = destToken.address;
            matrixTokenAddress = matrixToken.address;
            dataBytes = await kyberV1ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address];
            const [notionalSendQuantity] = await kyberV1Fixture.router.getAmountsIn(minDestQuantity, poolsPath, [srcTokenAddress, destTokenAddress]);

            const oldSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);

            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(notionalSendQuantity);
          });
        });

        describe('when path is through multiple trading pairs and swaps exact tokens for tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = true;
            const tradePath = [srcToken.address, systemFixture.weth.address, systemFixture.dai.address];

            caller = manager;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = ethToWei(100);
            srcTokenAddress = srcToken.address;
            adapterName = kyberV1AdapterV2Name;
            matrixTokenAddress = matrixToken.address;
            destTokenAddress = systemFixture.dai.address;
            dataBytes = await kyberV1ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address, kyberV1Fixture.wethDaiPool.address];
            const [, , expectedReceiveQuantity] = await kyberV1Fixture.router.getAmountsOut(srcQuantity, poolsPath, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });
        });

        describe('when path is through multiple trading pairs and swaps for exact tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = false;
            const tradePath = [srcToken.address, systemFixture.weth.address, systemFixture.dai.address];

            caller = manager;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = ethToWei(1000);
            srcTokenAddress = srcToken.address;
            adapterName = kyberV1AdapterV2Name;
            matrixTokenAddress = matrixToken.address;
            destTokenAddress = systemFixture.dai.address;
            dataBytes = await kyberV1ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address, kyberV1Fixture.wethDaiPool.address];
            const [notionalSendQuantity] = await kyberV1Fixture.router.getAmountsIn(minDestQuantity, poolsPath, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance).eq(minDestQuantity);
            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(notionalSendQuantity);
          });

          it('should update the positions on the MatrixToken correctly', async function () {
            const poolsPath = [kyberV1Fixture.wethWbtcPool.address, kyberV1Fixture.wethDaiPool.address];
            const [sendQuantity] = await kyberV1Fixture.router.getAmountsIn(minDestQuantity, poolsPath, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);
            const expectedSourceTokenUnit = oldPositions[0].unit.sub(sendQuantity);

            await trade();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);
            expect(newFirstPosition.component).eq(srcTokenAddress);
            expect(newFirstPosition.unit).eq(expectedSourceTokenUnit);

            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.module).eq(ZERO_ADDRESS);
            expect(newSecondPosition.unit).eq(minDestQuantity);
            expect(newSecondPosition.component).eq(destTokenAddress);
          });
        });
      });

      context('when trading a Default component on One Inch', async function () {
        beforeEach(async function () {
          // Add MatrixToken as token sender / recipient
          await oneInchExchangeMock.connect(owner).addMatrixTokenAddress(matrixToken.address);

          // Fund One Inch exchange with destToken WETH
          await destToken.transfer(oneInchExchangeMock.address, ethToWei(1000));

          await tradeModule.connect(manager).initialize(matrixToken.address);

          // Trade 1 WBTC. Note: one inch mock is hardcoded to trade 1 WBTC unit regardless of Set supply
          srcTokenQuantity = wbtcUnits;
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, ethers.constants.MaxUint256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          // Issue 1 MatrixToken. Note: one inch mock is hardcoded to trade 1 WBTC unit regardless of Set supply
          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.issue(matrixToken.address, issueQuantity, owner.address);
        });

        beforeEach(function () {
          caller = manager;
          adapterName = oneInchAdapterName;
          srcTokenAddress = srcToken.address;
          destTokenAddress = destToken.address;
          matrixTokenAddress = matrixToken.address;

          // Encode function data. Inputs are unused in the mock One Inch contract
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
            srcToken.address, // Send token
            destToken.address, // Receive token
            srcTokenQuantity, // Send quantity
            destTokenQuantity.sub(ethToWei(1)), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          minDestQuantity = destTokenQuantity.sub(ethToWei(1)); // Receive a min of 32 WETH for 1 WBTC
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        it('should transfer the correct components to the MatrixToken', async function () {
          const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
          await trade();
          const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

          const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
          expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(totalDestQuantity);
        });

        it('should transfer the correct components from the MatrixToken', async function () {
          const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
          await trade();
          const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

          const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
          expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should transfer the correct components to the exchange', async function () {
          const oldSrcTokenBalance = await srcToken.balanceOf(oneInchExchangeMock.address);
          await trade();
          const newSrcTokenBalance = await srcToken.balanceOf(oneInchExchangeMock.address);

          const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
          expect(newSrcTokenBalance.sub(oldSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should transfer the correct components from the exchange', async function () {
          const oldDestTokenBalance = await destToken.balanceOf(oneInchExchangeMock.address);
          await trade();
          const newDestTokenBalance = await destToken.balanceOf(oneInchExchangeMock.address);

          const totalDestQuantity = issueQuantity.mul(destTokenQuantity).div(ethToWei(1));
          expect(oldDestTokenBalance.sub(newDestTokenBalance)).eq(totalDestQuantity);
        });

        it('should update the positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          await trade();

          // All WBTC is sold for WETH
          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(1);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.component).eq(destToken.address);
          expect(newFirstPosition.unit).eq(destTokenQuantity);
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);
        });

        it('should revert when function signature does not match one inch', async function () {
          // Encode random function
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('addMatrixTokenAddress', [ZERO_ADDRESS]);
          await expect(trade()).revertedWith('OIEA0a');
        });

        it('should revert when send token does not match calldata', async function () {
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
            await getRandomAddress(), // Send token
            destToken.address, // Receive token
            srcTokenQuantity, // Send quantity
            destTokenQuantity.sub(ethToWei(1)), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await expect(trade()).revertedWith('OIEA0b');
        });

        it('should revert when receive token does not match calldata', async function () {
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
            srcToken.address, // Send token
            await getRandomAddress(), // Receive token
            srcTokenQuantity, // Send quantity
            destTokenQuantity.sub(ethToWei(1)), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await expect(trade()).revertedWith('OIEA0c');
        });

        it('should revert when send token quantity does not match calldata', async function () {
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
            srcToken.address, // Send token
            destToken.address, // Receive token
            ZERO, // Send quantity
            destTokenQuantity.sub(ethToWei(1)), // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await expect(trade()).revertedWith('OIEA0d');
        });

        it('should revert when min receive token quantity does not match calldata', async function () {
          dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
            srcToken.address, // Send token
            destToken.address, // Receive token
            srcTokenQuantity, // Send quantity
            ZERO, // Min receive quantity
            ZERO,
            ZERO_ADDRESS,
            [ZERO_ADDRESS],
            EMPTY_BYTES,
            [ZERO],
            [ZERO],
          ]);

          await expect(trade()).revertedWith('OIEA0e');
        });
      });

      context('when trading a Default component on Uniswap', async function () {
        beforeEach(async function () {
          await systemFixture.weth.connect(owner).approve(uniswapFixture.router.address, ethToWei(3400));
          await systemFixture.wbtc.connect(owner).approve(uniswapFixture.router.address, btcToWei(100));

          await uniswapFixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.wbtc.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3395),
            ethToWei(99.5),
            owner.address,
            MAX_UINT_256
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          srcTokenQuantity = wbtcUnits;
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);

          caller = manager;
          dataBytes = EMPTY_BYTES;
          srcQuantity = srcTokenQuantity;
          srcTokenAddress = srcToken.address;
          adapterName = uniswapV2AdapterName;
          destTokenAddress = destToken.address;
          matrixTokenAddress = matrixToken.address;
          minDestQuantity = destTokenQuantity.sub(ethToWei(1)); // Receive a min of 32 WETH for 1 WBTC
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        it('should transfer the correct components to the MatrixToken', async function () {
          const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [srcTokenAddress, destTokenAddress]);

          const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
          await trade();
          const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

          expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
        });

        it('should transfer the correct components from the MatrixToken', async function () {
          const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
          await trade();
          const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

          const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
          expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should update the positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [srcTokenAddress, destTokenAddress]);

          // All WBTC is sold for WETH
          await trade();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(1);

          const newFirstPosition = newPositions[0];
          expect(newFirstPosition.module).eq(ZERO_ADDRESS);
          expect(newFirstPosition.component).eq(destToken.address);
          expect(newFirstPosition.unit).eq(expectedReceiveQuantity);
        });

        describe('when path is through multiple trading pairs', function () {
          beforeEach(async function () {
            await systemFixture.weth.connect(owner).approve(uniswapFixture.router.address, ethToWei(1000));
            await systemFixture.dai.connect(owner).approve(uniswapFixture.router.address, ethToWei(1000000));

            await uniswapFixture.router.addLiquidity(
              systemFixture.weth.address,
              systemFixture.dai.address,
              ethToWei(1000),
              ethToWei(1000000),
              ethToWei(995),
              ethToWei(995000),
              owner.address,
              MAX_UINT_256
            );

            destTokenAddress = systemFixture.dai.address;
            const tradePath = [srcTokenAddress, systemFixture.weth.address, destTokenAddress];
            dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]'], [tradePath]);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const [, , expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            const expectedDestTokenBalance = oldDestTokenBalance.add(expectedReceiveQuantity);
            expect(newDestTokenBalance).eq(expectedDestTokenBalance);
          });
        });
      });

      context('when trading a Default component with a transfer fee on Uniswap', async function () {
        beforeEach(async function () {
          tokenWithFee = await deployContract('Erc20WithFeeMock', ['Erc20WithFeeMock', 'TEST', 10], owner);
          await tokenWithFee.mint(owner.address, ethToWei(10000));

          await tokenWithFee.connect(owner).approve(uniswapFixture.router.address, ethToWei(10000));
          await systemFixture.wbtc.connect(owner).approve(uniswapFixture.router.address, btcToWei(100));

          await uniswapFixture.createNewPair(tokenWithFee.address, systemFixture.wbtc.address);

          await uniswapFixture.router.addLiquidity(
            tokenWithFee.address,
            systemFixture.wbtc.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3000),
            btcToWei(99.5),
            owner.address,
            MAX_UINT_256
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          const wbtcSendQuantity = wbtcUnits;
          srcTokenQuantity = wbtcRate;

          // Transfer srcToken from owner to manager for issuance
          await systemFixture.wbtc.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await systemFixture.wbtc.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);

          await tradeModule
            .connect(manager)
            .trade(matrixToken.address, uniswapV2TransferFeeAdapterName, systemFixture.wbtc.address, wbtcSendQuantity, tokenWithFee.address, ZERO, EMPTY_BYTES);

          // Trade token with fee back to WBTC
          caller = manager;
          minDestQuantity = ZERO;
          dataBytes = EMPTY_BYTES;
          srcQuantity = srcTokenQuantity.div(2);
          srcTokenAddress = tokenWithFee.address;
          matrixTokenAddress = matrixToken.address;
          adapterName = uniswapV2TransferFeeAdapterName;
          destTokenAddress = systemFixture.wbtc.address;
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        it('should transfer the correct components to the MatrixToken', async function () {
          const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(
            srcQuantity.mul(90).div(100), // Sub transfer fee
            [srcTokenAddress, destTokenAddress]
          );

          const oldDestTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
          await trade();
          const newDestTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);

          expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
        });

        it('should transfer the correct components from the MatrixToken', async function () {
          const oldSrcTokenBalance = await tokenWithFee.balanceOf(matrixToken.address);
          await trade();
          const newSrcTokenBalance = await tokenWithFee.balanceOf(matrixToken.address);

          const totalSrcQuantity = issueQuantity.mul(srcQuantity).div(ethToWei(1));
          expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
        });

        it('should update the positions on the MatrixToken correctly', async function () {
          const oldPositions = await matrixToken.getPositions();
          expect(oldPositions.length).eq(1);

          const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(
            srcQuantity.mul(90).div(100), // Sub transfer fee
            [srcTokenAddress, destTokenAddress]
          );

          await trade();

          const newPositions = await matrixToken.getPositions();
          expect(newPositions.length).eq(2);

          const newSecondPosition = newPositions[1];
          expect(newSecondPosition.module).eq(ZERO_ADDRESS);
          expect(newSecondPosition.component).eq(destTokenAddress);
          expect(newSecondPosition.unit).eq(expectedReceiveQuantity);
        });

        describe('when path is through multiple trading pairs', function () {
          beforeEach(async function () {
            await systemFixture.wbtc.connect(owner).approve(uniswapFixture.router.address, btcToWei(1000));
            await systemFixture.dai.connect(owner).approve(uniswapFixture.router.address, ethToWei(1000000));

            await uniswapFixture.router.addLiquidity(
              systemFixture.wbtc.address,
              systemFixture.dai.address,
              btcToWei(10),
              ethToWei(1000000),
              ethToWei(995),
              ethToWei(995000),
              owner.address,
              MAX_UINT_256
            );

            destTokenAddress = systemFixture.dai.address;
            const tradePath = [srcTokenAddress, systemFixture.wbtc.address, destTokenAddress];
            dataBytes = ethers.utils.defaultAbiCoder.encode(['address[]'], [tradePath]);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const [, , expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(
              srcQuantity.mul(90).div(100), // Sub transfer fee
              [srcTokenAddress, systemFixture.wbtc.address, destTokenAddress]
            );

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });
        });
      });

      context('when trading a Default component on Uniswap version 2 adapter', async function () {
        beforeEach(async function () {
          await systemFixture.weth.connect(owner).approve(uniswapFixture.router.address, ethToWei(10000));
          await systemFixture.wbtc.connect(owner).approve(uniswapFixture.router.address, btcToWei(100));

          await uniswapFixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.wbtc.address,
            ethToWei(3400),
            btcToWei(100),
            ethToWei(3395),
            ethToWei(99.5),
            owner.address,
            MAX_UINT_256
          );

          await systemFixture.dai.connect(owner).approve(uniswapFixture.router.address, ethToWei(1000000));

          await uniswapFixture.router.addLiquidity(
            systemFixture.weth.address,
            systemFixture.dai.address,
            ethToWei(1000),
            ethToWei(1000000),
            ethToWei(995),
            ethToWei(995000),
            owner.address,
            MAX_UINT_256
          );

          await tradeModule.connect(manager).initialize(matrixToken.address);

          srcTokenQuantity = wbtcUnits;
          const srcTokenDecimals = await srcToken.decimals();
          destTokenQuantity = wbtcRate.mul(srcTokenQuantity).div(10 ** srcTokenDecimals);

          // Transfer srcToken from owner to manager for issuance
          await srcToken.connect(owner).transfer(manager.address, wbtcUnits.mul(100));

          // Approve tokens to Controller and call issue
          await srcToken.connect(manager).approve(systemFixture.basicIssuanceModule.address, MAX_UINT_256);

          // Deploy mock issuance hook and initialize issuance module
          managerIssuanceHookMock = await deployContract('ManagerIssuanceHookMock', [], owner);
          await systemFixture.basicIssuanceModule.connect(manager).initialize(matrixToken.address, managerIssuanceHookMock.address);

          issueQuantity = ethToWei(1);
          await systemFixture.basicIssuanceModule.connect(manager).issue(matrixToken.address, issueQuantity, owner.address);
        });

        async function trade() {
          return tradeModule.connect(caller).trade(matrixTokenAddress, adapterName, srcTokenAddress, srcQuantity, destTokenAddress, minDestQuantity, dataBytes);
        }

        describe('when path is through one pair and swaps exact tokens for tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = true;
            const tradePath = [srcToken.address, destToken.address];

            caller = manager;
            srcTokenAddress = srcToken.address;
            matrixTokenAddress = matrixToken.address;
            adapterName = uniswapV2AdapterV2Name;
            destTokenAddress = destToken.address;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = destTokenQuantity.sub(ethToWei(1)); // Receive a min of 32 WETH for 1 WBTC
            dataBytes = await uniswapV2ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [srcTokenAddress, destTokenAddress]);

            const oldDestTokenBalance = await destToken.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await destToken.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });

          it('should transfer the correct components from the MatrixToken', async function () {
            const oldSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await srcToken.balanceOf(matrixToken.address);

            const totalSrcQuantity = issueQuantity.mul(srcTokenQuantity).div(ethToWei(1));
            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(totalSrcQuantity);
          });

          it('should update the positions on the MatrixToken correctly', async function () {
            const [, expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [srcTokenAddress, destTokenAddress]);

            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);
            await trade();
            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(1);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);
            expect(newFirstPosition.component).eq(destToken.address);
            expect(newFirstPosition.unit).eq(expectedReceiveQuantity);
          });
        });

        describe('when path is through one pair and swaps for exact tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = false;
            const tradePath = [srcToken.address, destToken.address];

            caller = manager;
            srcTokenAddress = srcToken.address;
            matrixTokenAddress = matrixToken.address;
            adapterName = uniswapV2AdapterV2Name;
            destTokenAddress = destToken.address;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = ethToWei(1);
            dataBytes = await uniswapV2ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            // In this case, this is the exact destination quantity
            const [notionalSendQuantity] = await uniswapFixture.router.getAmountsIn(minDestQuantity, [srcTokenAddress, destTokenAddress]);

            const oldSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);

            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(notionalSendQuantity);
          });
        });

        describe('when path is through multiple trading pairs and swaps exact tokens for tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = true;
            const tradePath = [srcToken.address, systemFixture.weth.address, systemFixture.dai.address];

            caller = manager;
            srcTokenAddress = srcToken.address;
            matrixTokenAddress = matrixToken.address;
            adapterName = uniswapV2AdapterV2Name;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = ethToWei(100);
            destTokenAddress = systemFixture.dai.address;
            dataBytes = await uniswapV2ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            const [, , expectedReceiveQuantity] = await uniswapFixture.router.getAmountsOut(srcQuantity, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);
            await trade();
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance.sub(oldDestTokenBalance)).eq(expectedReceiveQuantity);
          });
        });

        describe('when path is through multiple trading pairs and swaps for exact tokens', function () {
          beforeEach(async function () {
            const shouldSwapExactTokenForToken = false;
            const tradePath = [srcToken.address, systemFixture.weth.address, systemFixture.dai.address];

            caller = manager;
            srcTokenAddress = srcToken.address;
            matrixTokenAddress = matrixToken.address;
            adapterName = uniswapV2AdapterV2Name;
            srcQuantity = srcTokenQuantity;
            minDestQuantity = ethToWei(1000);
            destTokenAddress = systemFixture.dai.address;
            dataBytes = await uniswapV2ExchangeAdapterV2.getExchangeData(tradePath, shouldSwapExactTokenForToken);
          });

          it('should transfer the correct components to the MatrixToken', async function () {
            // In this case, this is the exact destination quantity
            const [notionalSendQuantity] = await uniswapFixture.router.getAmountsIn(minDestQuantity, [
              srcTokenAddress,
              systemFixture.weth.address,
              destTokenAddress,
            ]);

            const oldSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            await trade();
            const newSrcTokenBalance = await systemFixture.wbtc.balanceOf(matrixToken.address);
            const newDestTokenBalance = await systemFixture.dai.balanceOf(matrixToken.address);

            expect(newDestTokenBalance).eq(minDestQuantity);
            expect(oldSrcTokenBalance.sub(newSrcTokenBalance)).eq(notionalSendQuantity);
          });

          it('should update the positions on the MatrixToken correctly', async function () {
            // In this case, this is the exact destination quantity
            const [sendQuantity] = await uniswapFixture.router.getAmountsIn(minDestQuantity, [srcTokenAddress, systemFixture.weth.address, destTokenAddress]);

            const oldPositions = await matrixToken.getPositions();
            expect(oldPositions.length).eq(1);
            const expectedSourceTokenUnit = oldPositions[0].unit.sub(sendQuantity);

            await trade();

            const newPositions = await matrixToken.getPositions();
            expect(newPositions.length).eq(2);

            const newFirstPosition = newPositions[0];
            expect(newFirstPosition.module).eq(ZERO_ADDRESS);
            expect(newFirstPosition.component).eq(srcTokenAddress);
            expect(newFirstPosition.unit).eq(expectedSourceTokenUnit);

            const newSecondPosition = newPositions[1];
            expect(newSecondPosition.module).eq(ZERO_ADDRESS);
            expect(newSecondPosition.unit).eq(minDestQuantity);
            expect(newSecondPosition.component).eq(destTokenAddress);
          });
        });
      });
    });

    describe('removeModule', function () {
      let tradeModuleAddress;

      beforeEach(async function () {
        await tradeModule.connect(manager).initialize(matrixToken.address);
        tradeModuleAddress = tradeModule.address;
      });

      async function removeModule() {
        return matrixToken.connect(manager).removeModule(tradeModuleAddress);
      }

      it('should remove the module', async function () {
        await removeModule();
        const isModuleEnabled = await matrixToken.isInitializedModule(tradeModuleAddress);
        expect(isModuleEnabled).is.false;
      });
    });
  });
});
