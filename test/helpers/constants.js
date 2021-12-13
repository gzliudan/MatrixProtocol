// SPDX-License-Identifier: Apache-2.0

// ==================== External Imports ====================

const { constants, BigNumber } = require('hardhat').ethers;
const { One, Two, Zero, HashZero, WeiPerEther, MaxUint256, AddressZero } = constants;

const ZERO = Zero;
const ONE = One;
const TWO = Two;
const THREE = BigNumber.from(3);
const ZERO_HASH = HashZero;
const PRECISE_UNIT = WeiPerEther;
const MIN_INT_256 = BigNumber.from('-0x8000000000000000000000000000000000000000000000000000000000000000');
const MAX_INT_256 = BigNumber.from('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const MAX_UINT_256 = MaxUint256;

const ONE_HOUR_IN_SECONDS = 60 * 60;
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const ONE_YEAR_IN_SECONDS = 31557600;

const EMPTY_BYTES = '0x';
const ZERO_BYTES = '0x0000000000000000000000000000000000000000000000000000000000000000';

const ZERO_ADDRESS = AddressZero;
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const MODULE_STATE = {
  NONE: 0,
  PENDING: 1,
  INITIALIZED: 2,
};

const POSITION_STATE = {
  DEFAULT: 0,
  EXTERNAL: 1,
};

const NOT_OWNER_MSG = 'Ownable: caller is not the owner';

module.exports = {
  ZERO,
  ONE,
  TWO,
  THREE,
  ZERO_HASH,
  PRECISE_UNIT,
  MIN_INT_256,
  MAX_INT_256,
  MAX_UINT_256,
  ONE_HOUR_IN_SECONDS,
  ONE_DAY_IN_SECONDS,
  ONE_YEAR_IN_SECONDS,
  EMPTY_BYTES,
  ZERO_BYTES,
  ZERO_ADDRESS,
  ETH_ADDRESS,
  MODULE_STATE,
  POSITION_STATE,
  NOT_OWNER_MSG,
};
