// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { ethToWei, usdToWei } = require('../helpers/unitUtil');
const { testCases } = require('../cases/unitConversionUtil.json');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('library UnitConversionUtil', function () {
  const usdcDecimals = 6;
  let unitMock;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    unitMock = await deployContract('UnitConversionUtilMock');
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  testCases.map(function (testCase, i) {
    const weiOfEth = ethToWei(testCase);
    const weiOfUsd = usdToWei(testCase);

    describe(`test case ${i}`, function () {
      it(`test fromPreciseUnitToDecimals(${weiOfEth}, ${usdcDecimals}) - uint256`, async function () {
        const result = await unitMock.fromPreciseUnitToDecimalsUint(weiOfEth, usdcDecimals);
        expect(result).eq(weiOfUsd);
      });

      it(`test fromPreciseUnitToDecimals(${weiOfEth}, ${usdcDecimals}) - int256`, async function () {
        const result = await unitMock.fromPreciseUnitToDecimalsInt(weiOfEth, usdcDecimals);
        expect(result).eq(weiOfUsd);
      });

      it(`test toPreciseUnitsFromDecimals(${weiOfUsd}, ${usdcDecimals}) - int256`, async function () {
        const result = await unitMock.toPreciseUnitsFromDecimals(weiOfUsd, usdcDecimals);
        expect(result).eq(weiOfEth);
      });
    });
  });
});
