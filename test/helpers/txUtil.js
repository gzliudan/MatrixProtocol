// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { provider } = require('hardhat').waffle;

function encodeData(contract, functionName, args) {
  const func = contract.interface.getFunction(functionName);
  return contract.interface.encodeFunctionData(func, args);
}

async function approve(signer, tokenContract, spender, amount) {
  const data = encodeData(tokenContract, 'approve', [spender, amount]);

  return await signer.sendTransaction({
    to: tokenContract.address,
    data,
  });
}

async function sendEth(signer, to, value) {
  await signer.sendTransaction({ to, value });
}

/// @dev get transaction timestamp
async function getTransactionTimestamp(txFunc) {
  const txData = await txFunc;
  return (await provider.getBlock(txData.block)).timestamp;
}

module.exports = {
  encodeData,
  approve,
  sendEth,
  getTransactionTimestamp,
};
