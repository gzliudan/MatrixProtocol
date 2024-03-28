// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { compareArray } = require('../helpers/arrayUtil');
const { testCases } = require('../cases/uint256ArrayUtil.json');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('library Uint256ArrayUtil', function () {
  let arrayMock;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    arrayMock = await deployContract('Uint256ArrayMock');
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  testCases.map(function (testCase, i) {
    describe(`test case ${i}`, function () {
      const array1 = testCase.array1;
      const array2 = testCase.array2;
      const result1 = testCase.result;
      it(`function merge(${JSON.stringify(array1)}, ${JSON.stringify(array2)})`, async function () {
        const result2 = await arrayMock.merge(array1, array2);
        expect(compareArray(result1, result2)).is.true;
      });
    });
  });
});
