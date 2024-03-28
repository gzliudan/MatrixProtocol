// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { expect } = require('chai');
const { BigNumber } = require('hardhat').ethers;

// ==================== Internal Imports ====================

const { ethToWei } = require('../helpers/unitUtil');
const { deployContract } = require('../helpers/deploy');
const { UintValues, IntValues } = require('../cases/preciseUnitMath.json');
const { snapshotBlockchain, revertBlockchain } = require('../helpers/evmUtil.js');
const { ZERO, PRECISE_UNIT, MAX_UINT_256, MIN_INT_256, MAX_INT_256 } = require('../helpers/constants');

const {
  preciseMul,
  preciseDiv,
  preciseMulCeilUint,
  preciseDivCeilUint,
  preciseMulFloorInt,
  preciseDivCeilInt,
  preciseDivFloorInt,
} = require('../helpers/mathUtil');

describe('library PreciseUnitMath', function () {
  let mathMock;

  let snapshotId;
  before(async function () {
    snapshotId = await snapshotBlockchain();
    mathMock = await deployContract('PreciseUnitMathMock');
  });

  after(async function () {
    await revertBlockchain(snapshotId);
  });

  describe('test constant functions', function () {
    it('test preciseUnit()', async function () {
      expect(await mathMock.preciseUnit()).eq(PRECISE_UNIT);
    });

    it('test preciseUnitInt()', async function () {
      expect(await mathMock.preciseUnitInt()).eq(PRECISE_UNIT);
    });

    it('test maxUint256()', async function () {
      expect(await mathMock.maxUint256()).eq(MAX_UINT_256);
    });

    it('test minInt256()', async function () {
      expect(await mathMock.minInt256()).eq(MIN_INT_256);
    });

    it('test maxInt256()', async function () {
      expect(await mathMock.maxInt256()).eq(MAX_INT_256);
    });
  });

  UintValues.map(function (UintValue, i) {
    const preciseNumber1 = BigNumber.from(UintValue);
    const preciseNumber2 = ethToWei(i + 1);

    context(`test case ${i}`, function () {
      describe('test preciseMul(uint256, uint256)', function () {
        it(`test preciseMul(${preciseNumber1}, ${ZERO})`, async function () {
          const result = await mathMock.preciseMul(preciseNumber1, ZERO);
          expect(result).eq(ZERO);
        });

        it(`test preciseMul(${ZERO}, ${preciseNumber1})`, async function () {
          const result = await mathMock.preciseMul(ZERO, preciseNumber1);
          expect(result).eq(ZERO);
        });

        it(`test preciseMul(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMul(a, b);
            expect(result).eq(preciseNumber1);
          } else {
            await expect(mathMock.preciseMul(a, b)).reverted;
          }
        });

        it(`test preciseMul(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMul(a, b);
            expect(result).eq(preciseNumber1);
          } else {
            await expect(mathMock.preciseMul(a, b)).reverted;
          }
        });

        it(`test preciseMul(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMul(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMul(a, b)).reverted;
          }
        });

        it(`test preciseMul(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMul(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMul(a, b)).reverted;
          }
        });
      });

      describe('test preciseMulCeil(uint256, uint256)', function () {
        it(`test preciseMulCeil(${preciseNumber1}, ${ZERO})`, async function () {
          const result = await mathMock.preciseMulCeil(preciseNumber1, ZERO);
          expect(result).eq(ZERO);
        });

        it(`test preciseMulCeil(${ZERO}, ${preciseNumber1})`, async function () {
          const result = await mathMock.preciseMulCeil(ZERO, preciseNumber1);
          expect(result).eq(ZERO);
        });

        it(`test preciseMulCeil(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMulCeil(a, b);
            const expected = preciseMulCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulCeil(a, b)).reverted;
          }
        });

        it(`test preciseMulCeil(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMulCeil(a, b);
            const expected = preciseMulCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulCeil(a, b)).reverted;
          }
        });

        it(`test preciseMulCeil(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMulCeil(a, b);
            const expected = preciseMulCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulCeil(a, b)).reverted;
          }
        });

        it(`test preciseMulCeil(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (a.mul(b).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseMulCeil(a, b);
            const expected = preciseMulCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulCeil(a, b)).reverted;
          }
        });
      });

      describe('test preciseDiv(uint256, uint256)', function () {
        it(`test preciseDiv(${preciseNumber1}, ${ZERO})`, async function () {
          const a = preciseNumber1;
          const b = ZERO;
          await expect(mathMock.preciseDiv(a, b)).revertedWith('PM0');
        });

        it(`test preciseDiv(${ZERO}, ${preciseNumber1})`, async function () {
          const a = ZERO;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDiv(a, b)).revertedWith('PM0');
          } else {
            const result = await mathMock.preciseDiv(a, b);
            expect(result).eq(ZERO);
          }
        });

        it(`test preciseDiv(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDiv(a, b);
            expect(result).eq(preciseNumber1);
          } else {
            await expect(mathMock.preciseDiv(a, b)).reverted;
          }
        });

        it(`test preciseDiv(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDiv(a, b)).revertedWith('PM0');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDiv(a, b);
            const expected = preciseDiv(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDiv(a, b)).reverted;
          }
        });

        it(`test preciseDiv(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDiv(a, b);
            const expected = preciseDiv(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDiv(a, b)).reverted;
          }
        });

        it(`test preciseDiv(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDiv(a, b)).revertedWith('PM0');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDiv(a, b);
            const expected = preciseDiv(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDiv(a, b)).reverted;
          }
        });
      });

      describe('test preciseDivCeil(uint256, uint256)', function () {
        it(`test preciseDivCeil(${preciseNumber1}, ${ZERO})`, async function () {
          await expect(mathMock.preciseDivCeil(preciseNumber1, ZERO)).revertedWith('PM2');
        });

        it(`test preciseDivCeil(${ZERO}, ${preciseNumber1})`, async function () {
          const a = ZERO;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeil(a, b)).revertedWith('PM2');
          } else {
            const result = await mathMock.preciseDivCeil(a, b);
            expect(result).eq(ZERO);
          }
        });

        it(`test preciseDivCeil(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivCeil(a, b);
            const expected = preciseDivCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeil(a, b)).reverted;
          }
        });

        it(`test preciseDivCeil(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeil(a, b)).revertedWith('PM2');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivCeil(a, b);
            const expected = preciseDivCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeil(a, b)).reverted;
          }
        });

        it(`test preciseDivCeil(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivCeil(a, b);
            const expected = preciseDivCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeil(a, b)).reverted;
          }
        });

        it(`test preciseDivCeil(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeil(a, b)).revertedWith('PM2');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivCeil(a, b);
            const expected = preciseDivCeilUint(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeil(a, b)).reverted;
          }
        });
      });

      describe('test approximatelyEquals(uint256, uint256, uint256)', function () {
        const range = PRECISE_UNIT;
        const a = preciseNumber1;

        if (a.gt(range)) {
          const b = a.sub(range).sub(1);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.false;
          });
        }

        if (a.gte(range)) {
          let b = a.sub(range);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        if (a.gte(range.sub(1))) {
          let b = a.sub(range.sub(1));
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        if (a.gt(0)) {
          const b = a.sub(1);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        it(`test approximatelyEquals(${a}, ${a}, ${range})`, async function () {
          const result = await mathMock.approximatelyEquals(a, a, range);
          await expect(result).is.true;
        });

        if (a.lt(MAX_UINT_256)) {
          const b = a.add(1);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        if (MAX_UINT_256.sub(range.sub(1)).gte(a)) {
          const b = a.add(range.sub(1));
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        if (MAX_UINT_256.sub(range).gte(a)) {
          const b = a.add(range);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.true;
          });
        }

        if (MAX_UINT_256.sub(range).gt(a)) {
          const b = a.add(range).add(1);
          it(`test approximatelyEquals(${a}, ${b}, ${range})`, async function () {
            const result = await mathMock.approximatelyEquals(a, b, range);
            await expect(result).is.false;
          });
        }
      });
    });
  });

  IntValues.map(function (IntValue, i) {
    const preciseNumber1 = BigNumber.from(IntValue);
    const preciseNumber2 = ethToWei(i + 1);

    context(`test case ${i}`, function () {
      describe('test preciseMul(int256, int256)', function () {
        it(`test preciseMul(${preciseNumber1}, ${ZERO})`, async function () {
          const result = await mathMock.preciseMulInt(preciseNumber1, ZERO);
          expect(result).eq(ZERO);
        });

        it(`test preciseMul(${ZERO}, ${preciseNumber1})`, async function () {
          const result = await mathMock.preciseMulInt(ZERO, preciseNumber1);
          expect(result).eq(ZERO);
        });

        it(`test preciseMul(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulInt(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulInt(a, b)).reverted;
          }
        });

        it(`test preciseMul(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulInt(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulInt(a, b)).reverted;
          }
        });

        it(`test preciseMul(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulInt(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulInt(a, b)).reverted;
          }
        });

        it(`test preciseMul(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulInt(a, b);
            const expected = preciseMul(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulInt(a, b)).reverted;
          }
        });
      });

      // Datatype int256 has no preciseMulCeil function

      describe('test preciseMulFloor(int256, int256)', function () {
        it(`test preciseMulFloor(${preciseNumber1}, ${ZERO})`, async function () {
          const result = await mathMock.preciseMulFloorInt(preciseNumber1, ZERO);
          expect(result).eq(ZERO);
        });

        it(`test preciseMulFloor(${ZERO}, ${preciseNumber1})`, async function () {
          const result = await mathMock.preciseMulFloorInt(ZERO, preciseNumber1);
          expect(result).eq(ZERO);
        });

        it(`test preciseMulFloor(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulFloorInt(a, b);
            const expected = preciseMulFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulFloorInt(a, b)).reverted;
          }
        });

        it(`test preciseMulFloor(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulFloorInt(a, b);
            const expected = preciseMulFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulFloorInt(a, b)).reverted;
          }
        });

        it(`test preciseMulFloor(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulFloorInt(a, b);
            const expected = preciseMulFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulFloorInt(a, b)).reverted;
          }
        });

        it(`test preciseMulFloor(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          const c = a.mul(b);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseMulFloorInt(a, b);
            const expected = preciseMulFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseMulFloorInt(a, b)).reverted;
          }
        });
      });

      describe('test preciseDiv(int256, int256)', function () {
        it(`test preciseDiv(${preciseNumber1}, ${ZERO})`, async function () {
          await expect(mathMock.preciseDivInt(preciseNumber1, ZERO)).revertedWith('PM1');
        });

        it(`test preciseDiv(${ZERO}, ${preciseNumber1})`, async function () {
          const a = ZERO;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivInt(a, b)).revertedWith('PM1');
          } else {
            const result = await mathMock.preciseDivInt(a, b);
            expect(result).eq(ZERO);
          }
        });

        it(`test preciseDiv(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivInt(a, b);
            const expected = preciseDiv(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivInt(a, b)).reverted;
          }
        });

        it(`test preciseDiv(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivInt(a, b)).revertedWith('PM1');
          } else {
            const c = a.mul(PRECISE_UNIT);
            if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
              const result = await mathMock.preciseDivInt(a, b);
              const expected = preciseDiv(a, b);
              expect(result).eq(expected);
            } else {
              await expect(mathMock.preciseDivInt(a, b)).reverted;
            }
          }
        });

        it(`test preciseDiv(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivInt(a, b);
            const expected = preciseDiv(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivInt(a, b)).reverted;
          }
        });

        it(`test preciseDiv(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivInt(a, b)).revertedWith('PM1');
          } else {
            const c = a.mul(PRECISE_UNIT);
            if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
              const result = await mathMock.preciseDivInt(a, b);
              const expected = preciseDiv(a, b);
              expect(result).eq(expected);
            } else {
              await expect(mathMock.preciseDivInt(a, b)).reverted;
            }
          }
        });
      });

      describe('test preciseDivCeil(int256, int256)', function () {
        it(`test preciseDivCeil(${preciseNumber1}, ${ZERO})`, async function () {
          await expect(mathMock.preciseDivCeilInt(preciseNumber1, ZERO)).revertedWith('PM3');
        });

        it(`test preciseDivCeil(${ZERO}, ${preciseNumber1})`, async function () {
          const a = ZERO;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeilInt(a, b)).revertedWith('PM3');
          } else {
            const result = await mathMock.preciseDivCeilInt(a, b);
            expect(result).eq(ZERO);
          }
        });

        it(`test preciseDivCeil(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivCeilInt(a, b);
            const expected = preciseDivCeilInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeilInt(a, b)).reverted;
          }
        });

        it(`test preciseDivCeil(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeilInt(a, b)).revertedWith('PM3');
          } else {
            const c = a.mul(PRECISE_UNIT);
            if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
              const result = await mathMock.preciseDivCeilInt(a, b);
              const expected = preciseDivCeilInt(a, b);
              expect(result).eq(expected);
            } else {
              await expect(mathMock.preciseDivCeil(a, b)).reverted;
            }
          }
        });

        it(`test preciseDivCeil(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivCeilInt(a, b);
            const expected = preciseDivCeilInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeilInt(a, b)).reverted;
          }
        });

        it(`test preciseDivCeil(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivCeilInt(a, b)).revertedWith('PM3');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivCeilInt(a, b);
            const expected = preciseDivCeilInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivCeilInt(a, b)).reverted;
          }
        });
      });

      describe('test preciseDivFloor(int256, int256)', function () {
        it(`test preciseDivCeil(${preciseNumber1}, ${ZERO})`, async function () {
          await expect(mathMock.preciseDivFloorInt(preciseNumber1, ZERO)).revertedWith('PM4');
        });

        it(`test preciseDivFloor(${ZERO}, ${preciseNumber1})`, async function () {
          const a = ZERO;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivFloorInt(a, b)).revertedWith('PM4');
          } else {
            const result = await mathMock.preciseDivFloorInt(a, b);
            expect(result).eq(ZERO);
          }
        });

        it(`test preciseDivFloor(${preciseNumber1}, One)`, async function () {
          const a = preciseNumber1;
          const b = PRECISE_UNIT;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivFloorInt(a, b);
            const expected = preciseDivFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivFloorInt(a, b)).reverted;
          }
        });

        it(`test preciseDivFloor(One, ${preciseNumber1})`, async function () {
          const a = PRECISE_UNIT;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivFloorInt(a, b)).revertedWith('PM4');
          } else {
            const c = a.mul(PRECISE_UNIT);
            if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
              const result = await mathMock.preciseDivFloorInt(a, b);
              const expected = preciseDivFloorInt(a, b);
              expect(result).eq(expected);
            } else {
              await expect(mathMock.preciseDivFloorInt(a, b)).reverted;
            }
          }
        });

        it(`test preciseDivFloor(${preciseNumber1}, ${preciseNumber2})`, async function () {
          const a = preciseNumber1;
          const b = preciseNumber2;
          const c = a.mul(PRECISE_UNIT);
          if (c.lte(MAX_INT_256) && c.gte(MIN_INT_256)) {
            const result = await mathMock.preciseDivFloorInt(a, b);
            const expected = preciseDivFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivFloorInt(a, b)).reverted;
          }
        });

        it(`test preciseDivFloor(${preciseNumber2}, ${preciseNumber1})`, async function () {
          const a = preciseNumber2;
          const b = preciseNumber1;
          if (b.isZero()) {
            await expect(mathMock.preciseDivFloorInt(a, b)).revertedWith('PM4');
          } else if (a.mul(PRECISE_UNIT).lte(MAX_UINT_256)) {
            const result = await mathMock.preciseDivFloorInt(a, b);
            const expected = preciseDivFloorInt(a, b);
            expect(result).eq(expected);
          } else {
            await expect(mathMock.preciseDivFloorInt(a, b)).reverted;
          }
        });
      });
    });
  });
});
