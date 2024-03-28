// SPDX-License-Identifier: Apache-2.0

// ==================== Internal Imports ====================

const { PRECISE_UNIT, ZERO } = require('./constants');

function divFloor(a, b) {
  const result = a.div(b);
  const mod = result.mul(b).sub(a);
  return mod.isZero() || (a.gt(0) && b.gt(0)) || (a.lt(0) && b.lt(0)) ? result : result.sub(1);
}

function preciseMul(a, b) {
  return a.mul(b).div(PRECISE_UNIT);
}

function preciseDiv(a, b) {
  return a.mul(PRECISE_UNIT).div(b);
}

function preciseMulCeilUint(a, b) {
  return a.isZero() || b.isZero() ? ZERO : a.mul(b).sub(1).div(PRECISE_UNIT).add(1); // preciseMulCeil
}

function preciseDivCeilUint(a, b) {
  return a.isZero() || b.isZero() ? ZERO : a.mul(PRECISE_UNIT).sub(1).div(b).add(1); // preciseDivCeil
}

function preciseMulCeilInt(a, b) {
  const c = a.mul(b);
  const result = c.div(PRECISE_UNIT);

  if (c.mod(PRECISE_UNIT).isZero()) {
    return result;
  }

  return c.gte(0) ? result.add(1) : result.sub(1);
}

// Error: cannot modulo negative values (fault="cannot modulo negative values", operation="mod", code=NUMERIC_FAULT, version=bignumber/5.5.0)
function preciseDivCeilInt(a, b) {
  const c = a.mul(PRECISE_UNIT);
  const result = c.div(b);
  const mod = result.mul(b).sub(c);

  if (mod.isZero()) {
    return result;
  }

  return (a.gt(0) && b.gt(0)) || (a.lt(0) && b.lt(0)) ? result.add(1) : result.sub(1);
}

function preciseMulFloorInt(a, b) {
  const c = a.mul(b);
  return c.gte(0) || c.mod(PRECISE_UNIT).isZero() ? c.div(PRECISE_UNIT) : c.div(PRECISE_UNIT).sub(1);
}

// Error: cannot modulo negative values (fault="cannot modulo negative values", operation="mod", code=NUMERIC_FAULT, version=bignumber/5.5.0)
function preciseDivFloorInt(a, b) {
  return divFloor(a.mul(PRECISE_UNIT), b);
}

function min(valueOne, valueTwo) {
  return valueOne.lt(valueTwo) ? valueOne : valueTwo;
}

module.exports = {
  divFloor,
  preciseMul,
  preciseDiv,
  preciseMulCeilUint,
  preciseDivCeilUint,
  preciseMulCeilInt,
  preciseMulFloorInt,
  preciseDivCeilInt,
  preciseDivFloorInt,
  min,
};
