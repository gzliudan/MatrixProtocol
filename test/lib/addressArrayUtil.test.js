// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { testCases, others } = require('../cases/addressArrayUtil.json');
const { compareArray, quickPopArrayItem } = require('../helpers/arrayUtil');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('library AddressArrayUtil', () => {
  let arrayMock;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    arrayMock = await deployContract('AddressArrayMock');
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  testCases.map((testCase, i) => {
    context(`test case ${i}`, async () => {
      for (let j = 0; j < testCase.length; j++) {
        it(`test function indexOf(array, ${testCase[j]}) - exist address`, async () => {
          expect((await arrayMock.indexOf(testCase, testCase[j])).index).eq(j);
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function indexOf(array, ${others[j]}) - nonexist address`, async () => {
          expect((await arrayMock.indexOf(testCase, others[j])).found).is.false;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function contain(array, ${testCase[j]}) - exist address`, async () => {
          expect(await arrayMock.contain(testCase, testCase[j])).is.true;
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function contain(array, ${others[j]}) - nonexist address`, async () => {
          expect(await arrayMock.contain(testCase, others[j])).is.false;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicate(array) - No`, async () => {
          expect(await arrayMock.hasDuplicate(testCase.slice(0, j))).is.false;
          expect(await arrayMock.hasDuplicate(testCase.slice(j, testCase.length))).is.false;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicate(array) - Yes`, async () => {
          expect(await arrayMock.hasDuplicate(testCase.concat(testCase.slice(0, j + 1)))).is.true;
          expect(await arrayMock.hasDuplicate(testCase.concat(testCase.slice(j, testCase.length)))).is.true;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicateItem(array) - No`, async () => {
          const testArray = testCase.slice(0, j);
          await arrayMock.setTestArray(testArray);
          expect(await arrayMock.hasDuplicateItem()).is.false;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicateItem(array) - No`, async () => {
          const testArray = testCase.slice(j, testCase.length);
          await arrayMock.setTestArray(testArray);
          expect(await arrayMock.hasDuplicateItem()).is.false;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicateItem(array) - Yes`, async () => {
          const testArray = testCase.concat(testCase.slice(0, j + 1));
          await arrayMock.setTestArray(testArray);
          expect(await arrayMock.hasDuplicateItem()).is.true;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function hasDuplicateItem(array) - Yes`, async () => {
          const testArray = testCase.concat(testCase.slice(j, testCase.length));
          await arrayMock.setTestArray(testArray);
          expect(await arrayMock.hasDuplicateItem()).is.true;
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function removeValue(array, ${testCase[j]})) - exist address`, async () => {
          const result = await arrayMock.removeValue(testCase, testCase[j]);
          const expected = testCase.slice(0, j).concat(testCase.slice(j + 1, testCase.length));
          expect(compareArray(result, expected)).is.true;
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function removeValue(array, ${others[j]}) - nonexist address`, async () => {
          await expect(arrayMock.removeValue(testCase, others[j])).revertedWith('A0');
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function removeItem(array, ${testCase[j]})) - exist address`, async () => {
          await arrayMock.setTestArray(testCase);
          await arrayMock.removeItem(testCase[j]);
          const result = await arrayMock.getTestArray();
          const expected = testCase.slice(0, j).concat(testCase.slice(j + 1, testCase.length));
          expect(compareArray(result, expected)).is.true;
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function removeItem(array, ${others[j]}) - nonexist address`, async () => {
          await arrayMock.setTestArray(testCase);
          await expect(arrayMock.removeItem(others[j])).revertedWith('A1');
        });
      }

      for (let j = 0; j < testCase.length; j++) {
        it(`test function quickRemoveItem(array, ${testCase[j]})) - exist address`, async () => {
          await arrayMock.setTestArray(testCase);
          await arrayMock.quickRemoveItem(testCase[j]);
          const result = await arrayMock.getTestArray();
          let newArray = quickPopArrayItem(testCase.concat(), testCase[j]);
          expect(compareArray(result, newArray)).is.true;
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function quickRemoveItem(array, ${others[j]}) - nonexist address`, async () => {
          await arrayMock.setTestArray(testCase);
          await expect(arrayMock.quickRemoveItem(others[j])).revertedWith('A2');
        });
      }

      for (let j = 0; j < others.length; j++) {
        it(`test function merge(array1, array2)`, async () => {
          const newArray = others.slice(j, others.length);
          const result = await arrayMock.merge(testCase, newArray);
          const expected = testCase.concat(newArray);
          expect(compareArray(result, expected)).is.true;
        });
      }
    });
  });
});
