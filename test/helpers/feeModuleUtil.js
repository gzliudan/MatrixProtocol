// SPDX-License-Identifier: Apache-2.0

// ==================== Internal Imports ====================

const { preciseMul, preciseMulFloorInt } = require('./mathUtil');
const { ONE_YEAR_IN_SECONDS, PRECISE_UNIT } = require('./constants');

async function getStreamingFee(feeModule, matrixToken, previousAccrueTimestamp, recentAccrueTimestamp, streamingFee) {
  const feeState = await feeModule.getFeeState(matrixToken);
  const accrualRate = streamingFee ? streamingFee : feeState.streamingFeePercentage;
  const timeElapsed = recentAccrueTimestamp - previousAccrueTimestamp;

  return accrualRate.mul(timeElapsed).div(ONE_YEAR_IN_SECONDS);
}

function getStreamingFeeInflationAmount(inflationPercent, totalSupply) {
  const a = inflationPercent.mul(totalSupply);
  const b = PRECISE_UNIT.sub(inflationPercent);

  return a.div(b);
}

function getPostFeePositionUnits(preFeeUnits, inflationPercent) {
  const newUnits = [];

  for (let i = 0; i < preFeeUnits.length; i++) {
    if (preFeeUnits[i].gte(0)) {
      newUnits.push(preciseMul(preFeeUnits[i], PRECISE_UNIT.sub(inflationPercent)));
    } else {
      newUnits.push(preciseMulFloorInt(preFeeUnits[i], PRECISE_UNIT.sub(inflationPercent)));
    }
  }

  return newUnits;
}

module.exports = {
  getStreamingFee,
  getStreamingFeeInflationAmount,
  getPostFeePositionUnits,
};
