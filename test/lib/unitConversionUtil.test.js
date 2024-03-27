// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');

// ==================== Internal Imports ====================

const { deployContract } = require('../helpers/deploy');
const { ethToWei, usdToWei } = require('../helpers/unitUtil');
const { testCases } = require('../cases/unitConversionUtil.json');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');

describe('library UnitConversionUtil', () => {
  const usdcDecimals = 6;
  let unitMock;

  let snapshotId;
  before(async () => {
    snapshotId = await snapshotBlockchain();
    unitMock = await deployContract('UnitConversionUtilMock');
  });

  after(async () => {
    await revertBlockchain(snapshotId);
  });

  testCases.map((testCase, i) => {
    const weiOfEth = ethToWei(testCase);
    const weiOfUsd = usdToWei(testCase);

    describe(`test case ${i}`, () => {
      it(`test fromPreciseUnitToDecimals(${weiOfEth}, ${usdcDecimals}) - uint256`, async () => {
        const result = await unitMock.fromPreciseUnitToDecimalsUint(weiOfEth, usdcDecimals);
        expect(result).eq(weiOfUsd);
      });

      it(`test fromPreciseUnitToDecimals(${weiOfEth}, ${usdcDecimals}) - int256`, async () => {
        const result = await unitMock.fromPreciseUnitToDecimalsInt(weiOfEth, usdcDecimals);
        expect(result).eq(weiOfUsd);
      });

      it(`test toPreciseUnitsFromDecimals(${weiOfUsd}, ${usdcDecimals}) - int256`, async () => {
        const result = await unitMock.toPreciseUnitsFromDecimals(weiOfUsd, usdcDecimals);
        expect(result).eq(weiOfEth);
      });
    });
  });
});
