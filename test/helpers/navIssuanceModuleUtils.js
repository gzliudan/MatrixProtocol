// SPDX-License-Identifier: Apache-2.0

// ==================== Internal Imports ====================

const { PRECISE_UNIT } = require('./constants');
const { preciseMul, preciseMulCeilUint, preciseDiv, preciseDivCeilUint } = require('./mathUtil');

// quantity - quantity * managerFeePercentage - quantity * protocolDirectFeePercentage
function getExpectedPostFeeQuantity(quantity, managerFeePercentage, protocolDirectFeePercentage) {
  const managerFees = preciseMul(quantity, managerFeePercentage);
  const protocolDirectFees = preciseMul(quantity, protocolDirectFeePercentage);

  return quantity.sub(managerFees).sub(protocolDirectFees);
}

// oldSupply * oldPositionMultiplier  / newSupply
function getExpectedIssuePositionMultiplier(oldPositionMultiplier, oldSupply, newSupply) {
  // Inflation = (newSupply - oldSupply) / newSupply
  const inflation = preciseDivCeilUint(newSupply.sub(oldSupply), newSupply);

  // oldPositionMultiplier * (1 - inflation %)
  return preciseMul(oldPositionMultiplier, PRECISE_UNIT.sub(inflation));
}

// oldSupply * oldPositionMultiplier  / newSupply
function getExpectedRedeemPositionMultiplier(oldPositionMultiplier, oldSupply, newSupply) {
  // Inflation = (oldSupply - newSupply) / newSupply
  // const deflation = preciseDiv(oldSupply.sub(newSupply), newSupply);

  // oldPositionMultiplier * (1 + deflation %)
  // return preciseMul(oldPositionMultiplier, PRECISE_UNIT.add(deflation));

  return preciseDiv(preciseMul(oldPositionMultiplier, oldSupply), newSupply);
}

async function getExpectedMatrixTokenIssueQuantity(
  matrixToken,
  matrixValuer,
  reserveAsset,
  reserveAssetBaseUnits,
  reserveAssetQuantity,
  managerFeePercentage,
  protocolDirectFeePercentage,
  premiumPercentage
) {
  const matrixTokenSupply = await matrixToken.totalSupply();
  const matrixTokenValuation = await matrixValuer.calculateMatrixTokenValuation(matrixToken.address, reserveAsset);

  const reserveQuantitySubFees = getExpectedPostFeeQuantity(reserveAssetQuantity, managerFeePercentage, protocolDirectFeePercentage);
  const reserveQuantitySubFeesAndPremium = reserveQuantitySubFees.sub(preciseMul(reserveQuantitySubFees, premiumPercentage));

  const normalizedReserveQuantitySubFees = preciseDiv(reserveQuantitySubFees, reserveAssetBaseUnits);
  const normalizedReserveQuantitySubFeesAndPremium = preciseDiv(reserveQuantitySubFeesAndPremium, reserveAssetBaseUnits);

  const denominator = preciseMul(matrixTokenSupply, matrixTokenValuation).add(normalizedReserveQuantitySubFees).sub(normalizedReserveQuantitySubFeesAndPremium);

  return preciseDiv(preciseMul(normalizedReserveQuantitySubFeesAndPremium, matrixTokenSupply), denominator);
}

function getExpectedIssuePositionUnit(
  previousUnits,
  issueQuantity,
  oldSupply,
  newSupply,
  newPositionMultiplier,
  managerFeePercentage,
  protocolDirectFeePercentage
) {
  // Account for fees
  const issueQuantitySubFees = getExpectedPostFeeQuantity(issueQuantity, managerFeePercentage, protocolDirectFeePercentage);

  // (Previous supply * previous units + issueQuantitySubFees) / current supply
  const numerator = preciseMul(oldSupply, previousUnits).add(issueQuantitySubFees);
  const newPositionUnit = preciseDiv(numerator, newSupply);

  // Adjust for rounding on the contracts when converting between real and virtual units
  const roundDownPositionUnit = preciseMul(newPositionUnit, newPositionMultiplier);

  return preciseDiv(roundDownPositionUnit, newPositionMultiplier);
}

function getExpectedReserveRedeemQuantity(
  matrixTokenQuantityToRedeem,
  matrixTokenValuation,
  reserveAssetBaseUnits,
  managerFeePercentage,
  protocolDirectFeePercentage,
  premiumPercentage
) {
  const totalNotionalReserveQuantity = preciseMul(matrixTokenValuation, matrixTokenQuantityToRedeem);
  const totalPremium = preciseMulCeilUint(totalNotionalReserveQuantity, premiumPercentage);

  const totalNotionalReserveQuantitySubFees = getExpectedPostFeeQuantity(
    totalNotionalReserveQuantity.sub(totalPremium),
    managerFeePercentage,
    protocolDirectFeePercentage
  );

  return preciseMul(totalNotionalReserveQuantitySubFees, reserveAssetBaseUnits);
}

function getExpectedRedeemPositionUnit(
  previousUnits,
  matrixTokenQuantityToRedeem,
  matrixTokenValuation,
  reserveAssetBaseUnits,
  oldSupply,
  newSupply,
  newPositionMultiplier,
  // managerFeePercentage,
  // protocolDirectFeePercentage,
  premiumPercentage
) {
  const totalNotionalReserveQuantity = preciseMul(matrixTokenValuation, matrixTokenQuantityToRedeem);
  const totalPremium = preciseMulCeilUint(totalNotionalReserveQuantity, premiumPercentage);
  const totalReserveBalance = preciseMul(totalNotionalReserveQuantity.sub(totalPremium), reserveAssetBaseUnits);

  // (oldSupply * oldUnits - reserveQuantityToRedeem) / newSupply
  const numerator = preciseMul(oldSupply, previousUnits).sub(totalReserveBalance);
  const newPositionUnit = preciseDiv(numerator, newSupply);

  // Adjust for rounding on the contracts when converting between real and virtual units
  const roundDownPositionUnit = preciseMul(newPositionUnit, newPositionMultiplier);
  return preciseDiv(roundDownPositionUnit, newPositionMultiplier);
}

module.exports = {
  getExpectedPostFeeQuantity,
  getExpectedIssuePositionMultiplier,
  getExpectedRedeemPositionMultiplier,
  getExpectedMatrixTokenIssueQuantity,
  getExpectedIssuePositionUnit,
  getExpectedReserveRedeemQuantity,
  getExpectedRedeemPositionUnit,
};
