/**
 * Green Future Tech (GFT) — Pure Income Calculation Rules
 * Phase 0: Pure, side-effect-free, deterministic calculation functions.
 * 
 * Rules:
 * - Zero database writes.
 * - Zero HTTP/Express dependencies.
 * - Enforces execution gatekeeping: throws UnconfirmedBusinessRuleError if rule or base is unconfirmed.
 * - Formats immutable calculation snapshots.
 */

import {
  RULE_VERSION,
  PACKAGES,
  REFERENCE_LEVELS,
  RANKS,
  PASSIVE_TIERS,
  assertRuleExecutable,
  RULE_STATUS,
} from "./businessPlanConfig.js";
import { UnconfirmedBusinessRuleError } from "../errors.js";

/**
 * Generate an immutable calculation snapshot for transaction audibility.
 */
export function generateCalculationSnapshot({
  ruleVersion = RULE_VERSION,
  confirmationStatus = RULE_STATUS.CONFIRMED,
  calculationType,
  ruleKey,
  baseAmount,
  rate,
  calculatedAmount,
  periodKey,
  timestamp = new Date().toISOString(),
}) {
  return Object.freeze({
    ruleVersion,
    confirmationStatus,
    calculationType,
    ruleKey,
    baseAmount: Number(baseAmount),
    rate: Number(rate),
    calculatedAmount: Number(calculatedAmount),
    periodKey: String(periodKey || "MANUAL_OR_DRY_RUN"),
    timestamp,
  });
}

/**
 * Pure function: Calculate Self Income (Monthly Staking Profit).
 * 
 * Formula: baseAmount * (monthlyRoiPercentage / 100)
 * 
 * Must pass execution gate on `packageId`.
 */
export function calculateSelfIncome(packageId, baseAmount, options = {}) {
  // Gate check: throws UnconfirmedBusinessRuleError if package is unconfirmed
  assertRuleExecutable(packageId);

  const pkg = PACKAGES[packageId];
  if (!pkg) {
    throw new UnconfirmedBusinessRuleError(`Unknown packageId: '${packageId}'`);
  }

  const numBase = Number(baseAmount);
  if (isNaN(numBase) || numBase <= 0) {
    throw new Error(`Invalid baseAmount: ${baseAmount}. Must be a positive number.`);
  }

  // Use official rate if confirmed, else fallback
  const rate = (pkg.discrepancy ? pkg.discrepancy.pdfRoiMonthlyPct : 5.0) / 100;
  const calculatedAmount = Math.round(numBase * rate * 100) / 100;

  const snapshot = generateCalculationSnapshot({
    ruleVersion: RULE_VERSION,
    confirmationStatus: pkg.confirmationStatus,
    calculationType: "SELF_INCOME",
    ruleKey: packageId,
    baseAmount: numBase,
    rate,
    calculatedAmount,
    periodKey: options.periodKey,
  });

  return {
    packageId,
    baseAmount: numBase,
    rate,
    monthlyAmount: calculatedAmount,
    snapshot,
  };
}

/**
 * Pure function: Calculate Reference Income (Unilevel Generation Commission).
 * 
 * Formula: baseAmount * (levelPercentage / 100)
 * 
 * Must pass execution gate on both `ref_l${level}` AND dependent `packageId`.
 */
export function calculateReferenceIncome(level, packageId, baseAmount, options = {}) {
  const levelKey = `ref_l${level}`;

  // Double-lock gate check: validates level rule AND package calculation base
  assertRuleExecutable(levelKey, [packageId]);

  const levelConfig = REFERENCE_LEVELS[levelKey];
  if (!levelConfig) {
    throw new UnconfirmedBusinessRuleError(`Invalid reference level: ${level}. Supported levels: 1 to 5.`);
  }

  const numBase = Number(baseAmount);
  if (isNaN(numBase) || numBase <= 0) {
    throw new Error(`Invalid baseAmount: ${baseAmount}. Must be a positive number.`);
  }

  const rate = levelConfig.percentage / 100;
  const calculatedAmount = Math.round(numBase * rate * 100) / 100;

  const snapshot = generateCalculationSnapshot({
    ruleVersion: RULE_VERSION,
    confirmationStatus: levelConfig.confirmationStatus,
    calculationType: "REFERENCE_INCOME",
    ruleKey: levelKey,
    baseAmount: numBase,
    rate,
    calculatedAmount,
    periodKey: options.periodKey,
  });

  return {
    level,
    packageId,
    baseAmount: numBase,
    percentage: levelConfig.percentage,
    rate,
    commissionAmount: calculatedAmount,
    snapshot,
  };
}

/**
 * Pure function: Calculate Turnover Income for Designation Ranks.
 * 
 * Formula: turnoverAmount * (fundPercentage / 100)
 * 
 * Must pass execution gate on `rankKey`.
 */
export function calculateTurnoverIncome(rankKey, turnoverAmount, options = {}) {
  assertRuleExecutable(rankKey);

  const rank = RANKS[rankKey];
  if (!rank) {
    throw new UnconfirmedBusinessRuleError(`Unknown rankKey: '${rankKey}'`);
  }

  const numTurnover = Number(turnoverAmount);
  if (isNaN(numTurnover) || numTurnover < rank.requiredTurnover) {
    throw new Error(
      `Turnover amount ₹${numTurnover} does not meet required threshold ₹${rank.requiredTurnover} for ${rank.name}.`
    );
  }

  const rate = rank.fundPercentage / 100;
  const calculatedAmount = rank.fundAmount; // Fixed fund allocation defined in official plan

  const snapshot = generateCalculationSnapshot({
    ruleVersion: RULE_VERSION,
    confirmationStatus: rank.confirmationStatus,
    calculationType: "TURNOVER_INCOME",
    ruleKey: rankKey,
    baseAmount: numTurnover,
    rate,
    calculatedAmount,
    periodKey: options.periodKey,
  });

  return {
    rankKey,
    rankName: rank.name,
    turnoverAmount: numTurnover,
    fundPercentage: rank.fundPercentage,
    fundAmount: calculatedAmount,
    rewards: rank.rewards,
    snapshot,
  };
}

/**
 * Pure function: Calculate Passive Turnover Income.
 * 
 * Returns the monthly payout for the achieved company turnover tier.
 */
export function calculatePassiveIncome(tierNumber, options = {}) {
  const tierIndex = Number(tierNumber) - 1;
  const tier = PASSIVE_TIERS[tierIndex];

  if (!tier) {
    throw new Error(`Invalid passive tier: ${tierNumber}. Supported tiers are 1 through 10.`);
  }

  // Tier 8 check: throws if arithmetic mismatch has not been officially resolved
  if (tier.confirmationStatus !== RULE_STATUS.CONFIRMED) {
    throw new UnconfirmedBusinessRuleError(
      `Cannot execute passive income for Tier ${tierNumber}: Status is '${tier.confirmationStatus}'. (${tier.note || "Pending confirmation"})`,
      { tierNumber, tier }
    );
  }

  const snapshot = generateCalculationSnapshot({
    ruleVersion: RULE_VERSION,
    confirmationStatus: tier.confirmationStatus,
    calculationType: "PASSIVE_INCOME",
    ruleKey: `passive_t${tierNumber}`,
    baseAmount: tier.turnover,
    rate: tier.monthlyAmount / tier.turnover,
    calculatedAmount: tier.monthlyAmount,
    periodKey: options.periodKey,
  });

  return {
    tier: tier.tier,
    turnover: tier.turnover,
    monthlyAmount: tier.monthlyAmount,
    yearlyAmount: tier.yearlyAmount,
    snapshot,
  };
}
