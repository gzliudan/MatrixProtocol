// SPDX-License-Identifier: Apache-2.0

/* global web3 */

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../../../helpers/deploy');
const { getSigners } = require('../../../helpers/accountUtil');
const { ethToWei, btcToWei } = require('../../../helpers/unitUtil');
const { snapshotBlockchain, revertBlockchain } = require('../../../helpers/evmUtil.js');
const { ZERO, ONE, EMPTY_BYTES, ZERO_ADDRESS } = require('../../../helpers/constants');

describe('contract OneInchExchangeAdapter', async () => {
  const [owner, matrixTokenMock, wbtcMock, wethMock, oneInchSpenderMock, randomAccount] = await getSigners();

  let oneInchExchangeMock;
  let oneInchExchangeAdapter;
  let oneInchFunctionSignature; // Bytes;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();

    // Mock OneInch exchange that allows for only fixed exchange amounts
    oneInchExchangeMock = await deployContract('OneInchExchangeMock', [wbtcMock.address, wethMock.address, btcToWei(1), ethToWei(33)], owner);

    const functionSignature = 'swap(address,address,uint256,uint256,uint256,address,address[],bytes,uint256[],uint256[])';
    oneInchFunctionSignature = web3.eth.abi.encodeFunctionSignature(functionSignature);

    oneInchExchangeAdapter = await deployContract(
      'OneInchExchangeAdapter',
      [oneInchSpenderMock.address, oneInchExchangeMock.address, oneInchFunctionSignature],
      owner
    );
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  describe('constructor', async () => {
    it('should have the correct approve address', async () => {
      const actualAddress = await oneInchExchangeAdapter.getSpender();
      expect(actualAddress).eq(oneInchSpenderMock.address);
    });

    it('should have the correct exchange address', async () => {
      const actualAddress = await oneInchExchangeAdapter.getExchangeAddress();
      expect(actualAddress).eq(oneInchExchangeMock.address);
    });

    it('should have the correct swap function signature stored', async () => {
      const actualAddress = await oneInchExchangeAdapter.getFunctionSignature();
      expect(actualAddress).eq(oneInchFunctionSignature);
    });
  });

  describe('getTradeCalldata', async () => {
    const srcQuantity = ONE;
    const minDestQuantity = ONE;

    let srcToken;
    let destToken;
    let dataBytes;
    let matrixTokenAddress;

    beforeEach(async () => {
      // 1inch trades only need byte data as all method call data is generaged offchain
      srcToken = wbtcMock.address;
      destToken = wethMock.address;
      matrixTokenAddress = matrixTokenMock.address;

      // Get mock 1inch swap calldata
      dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
        srcToken, // Send token
        destToken, // Receive token
        srcQuantity, // Send quantity
        minDestQuantity, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);
    });

    async function getTradeCalldata() {
      return await oneInchExchangeAdapter.getTradeCalldata(srcToken, destToken, matrixTokenAddress, srcQuantity, minDestQuantity, dataBytes);
    }

    it('should return the correct trade calldata', async () => {
      const calldata = await getTradeCalldata();
      const expectedCallData = [oneInchExchangeMock.address, ZERO, dataBytes];
      expect(JSON.stringify(calldata)).eq(JSON.stringify(expectedCallData));
    });

    it('should revert when function signature does not match', async () => {
      dataBytes = EMPTY_BYTES;
      await expect(getTradeCalldata()).revertedWith('OIEA0a');
    });

    it('should revert when send token does not match calldata', async () => {
      const randomToken = randomAccount; // Get random source token
      dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
        randomToken.address, // Send token
        wethMock.address, // Receive token
        ONE, // Send quantity
        ONE, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);

      await expect(getTradeCalldata()).revertedWith('OIEA0b');
    });

    it('should revert when receive token does not match calldata', async () => {
      const randomToken = randomAccount; // Get random source token
      dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
        wbtcMock.address, // Send token
        randomToken.address, // Receive token
        ONE, // Send quantity
        ONE, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);

      await expect(getTradeCalldata()).revertedWith('OIEA0c');
    });

    it('should revert when send token quantity does not match calldata', async () => {
      dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
        wbtcMock.address, // Send token
        wethMock.address, // Receive token
        ZERO, // Send quantity
        ONE, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);

      await expect(getTradeCalldata()).revertedWith('OIEA0d');
    });

    it('should revert when min receive token quantity does not match calldata', async () => {
      dataBytes = oneInchExchangeMock.interface.encodeFunctionData('swap', [
        wbtcMock.address, // Send token
        wethMock.address, // Receive token
        ONE, // Send quantity
        ZERO, // Min receive quantity
        ZERO,
        ZERO_ADDRESS,
        [ZERO_ADDRESS],
        EMPTY_BYTES,
        [ZERO],
        [ZERO],
      ]);

      await expect(getTradeCalldata()).revertedWith('OIEA0e');
    });
  });
});
