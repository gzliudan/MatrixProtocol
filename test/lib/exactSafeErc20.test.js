// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { provider } = require('hardhat').waffle;

// ==================== Internal Imports ====================

const { approve } = require('../helpers/txUtil');
const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { testCases } = require('../cases/exactSafeErc20.json');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('library ExactSafeErc20', async () => {
  let appMock;
  let erc20Mock;
  const [owner, userA, userB] = provider.getWallets();

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    appMock = await deployContract('ExactSafeErc20Mock', [], owner);
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  testCases.map((testCase, i) => {
    context(`test case ${i}`, async () => {
      const { name, symbol, fee_percentage: feePercentage, amounts } = testCase;

      before(async () => {
        erc20Mock = await deployContract('Erc20WithFeeMock', [name, symbol, feePercentage], owner);

        await appMock.setErc20(erc20Mock.address);

        await erc20Mock.mint(appMock.address, ethToWei(10000));

        await erc20Mock.mint(userA.address, ethToWei(10000));
        await approve(userA, erc20Mock, appMock.address, ethToWei(10000));
      });

      amounts.map((amount, j) => {
        it(`${j}: exactSafeTransfer(userB, ${amount})`, async () => {
          if (amount > 0 && feePercentage > 0) {
            await expect(appMock.testExactSafeTransfer(userB.address, ethToWei(amount))).revertedWith('ES0');
          } else {
            const oldBalance = await erc20Mock.balanceOf(userB.address);
            await appMock.testExactSafeTransfer(userB.address, ethToWei(amount));
            const newBalance = await erc20Mock.balanceOf(userB.address);
            expect(oldBalance.add(ethToWei(amount))).eq(newBalance);
          }
        });

        it(`${j}: exactSafeTransferFrom(userA, userB, ${amount})`, async () => {
          if (amount > 0 && feePercentage > 0) {
            await expect(appMock.testExactSafeTransferFrom(userA.address, userB.address, ethToWei(amount))).revertedWith('ES1');
          } else {
            const oldBalance = await erc20Mock.balanceOf(userB.address);
            await appMock.testExactSafeTransferFrom(userA.address, userB.address, ethToWei(amount));
            const newBalance = await erc20Mock.balanceOf(userB.address);
            expect(oldBalance.add(ethToWei(amount))).eq(newBalance);
          }
        });
      });
    });
  });
});
