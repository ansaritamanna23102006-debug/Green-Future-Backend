/**
 * Green Future Tech (GFT) — Authoritative Business Plan Configuration
 * Phase 0: Freezing Business Specifications & Execution Gatekeeping
 * 
 * IMPORTANT:
 * All financial rules remain strictly gated under `BUSINESS_PLAN_STATUS`.
 * No unconfirmed rule or dependent package can execute live financial calculations.
 */

import { UnconfirmedBusinessRuleError } from "../errors.js";

export const BUSINESS_PLAN_STATUS = "REQUIRES_CLIENT_CONFIRMATION";
export const RULE_VERSION = "BUSINESS_PLAN_DRAFT_V0";

export const RULE_STATUS = Object.freeze({
  CONFIRMED: "CONFIRMED",
  REQUIRES_CLIENT_CONFIRMATION: "REQUIRES_CLIENT_CONFIRMATION",
  DISABLED: "DISABLED",
});

/**
 * 8 GFT Startup Packages
 * All currently marked REQUIRES_CLIENT_CONFIRMATION due to price/ROI discrepancies
 * between the official plan PDF and the prototype UI.
 */
export const PACKAGES = Object.freeze({
  pkg_gft_1: {
    packageId: "pkg_gft_1",
    name: "GFT-1",
    category: "Student",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 3000,
      uiPrice: 1200,
      pdfRoiMonthlyPct: 5.0,
      uiRoiMonthlyPct: 5.0,
      note: "Price discrepancy: Plan PDF defines ₹3,000; prototype UI defines ₹1,200.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_2: {
    packageId: "pkg_gft_2",
    name: "GFT-2",
    category: "Student",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 5000,
      uiPrice: 3000,
      pdfRoiMonthlyPct: 5.0,
      uiRoiMonthlyPct: 6.0,
      note: "Price and ROI discrepancy: Plan PDF defines ₹5,000 @ 5%; prototype UI defines ₹3,000 @ 6%.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_3: {
    packageId: "pkg_gft_3",
    name: "GFT-3",
    category: "Student",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 10000,
      uiPrice: 5000,
      pdfRoiMonthlyPct: 5.0,
      uiRoiMonthlyPct: 7.0,
      note: "Price and ROI discrepancy: Plan PDF defines ₹10,000 @ 5%; prototype UI defines ₹5,000 @ 7%.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_4: {
    packageId: "pkg_gft_4",
    name: "GFT-4",
    category: "Personal",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 20000,
      uiPrice: 20000,
      pdfRoiMonthlyPct: 6.0,
      uiRoiMonthlyPct: 8.5,
      note: "ROI discrepancy: Plan PDF defines 6.0% monthly; prototype UI defines 8.5% monthly.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_5: {
    packageId: "pkg_gft_5",
    name: "GFT-5",
    category: "Personal",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 30000,
      uiPrice: 30000,
      pdfRoiMonthlyPct: 6.0,
      uiRoiMonthlyPct: 10.0,
      note: "ROI discrepancy: Plan PDF defines 6.0% monthly; prototype UI defines 10.0% monthly.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_6: {
    packageId: "pkg_gft_6",
    name: "GFT-6",
    category: "Personal",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 40000,
      uiPrice: 50000,
      pdfRoiMonthlyPct: 7.0,
      uiRoiMonthlyPct: 11.5,
      note: "Price and ROI discrepancy: Plan PDF defines ₹40,000 @ 7%; prototype UI defines ₹50,000 @ 11.5%.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_7: {
    packageId: "pkg_gft_7",
    name: "GFT-7",
    category: "Business",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 50000,
      uiPrice: 100000,
      pdfRoiMonthlyPct: 7.0,
      uiRoiMonthlyPct: 12.5,
      note: "Price and ROI discrepancy: Plan PDF defines ₹50,000 @ 7%; prototype UI defines ₹100,000 @ 12.5%.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
  pkg_gft_8: {
    packageId: "pkg_gft_8",
    name: "GFT-8",
    category: "Business",
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPrice: 100000,
      uiPrice: 500000,
      pdfRoiMonthlyPct: 8.0,
      uiRoiMonthlyPct: 15.0,
      note: "Price and ROI discrepancy: Plan PDF defines ₹100,000 @ 8%; prototype UI defines ₹500,000 @ 15.0%.",
    },
    durationMonths: 12,
    lockInDays: 365,
  },
});

/**
 * 5-Level Reference Income Percentages
 * Levels 1-3 confirmed in Plan PDF.
 * Levels 4-5 have discrepancies between PDF and prototype UI.
 */
export const REFERENCE_LEVELS = Object.freeze({
  ref_l1: {
    level: 1,
    percentage: 5.0,
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  ref_l2: {
    level: 2,
    percentage: 3.0,
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  ref_l3: {
    level: 3,
    percentage: 2.0,
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  ref_l4: {
    level: 4,
    percentage: 1.5,
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPct: 1.5,
      uiPct: 1.0,
      note: "Discrepancy: Plan PDF specifies 1.50%; prototype UI used 1.00%.",
    },
  },
  ref_l5: {
    level: 5,
    percentage: 1.0,
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    discrepancy: {
      pdfPct: 1.0,
      uiPct: 0.5,
      note: "Discrepancy: Plan PDF specifies 1.00%; prototype UI used 0.50%.",
    },
  },
});

/**
 * Designation & Turnover Ranks
 * Confirmed in Plan PDF.
 */
export const RANKS = Object.freeze({
  rank_silver: {
    key: "rank_silver",
    name: "Silver",
    requiredTurnover: 250000,
    leftTurnover: 125000,
    rightTurnover: 125000,
    fundPercentage: 2.0,
    fundAmount: 5000,
    rewards: "GFT Smart Mobile / Pin",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_gold: {
    key: "rank_gold",
    name: "Gold",
    requiredTurnover: 750000,
    prerequisite: "1 Silver Left, 1 Silver Right, 2.50 Lakh side maintenance",
    fundPercentage: 1.5,
    fundAmount: 11250,
    rewards: "Fossil Watch (Model BQ2493)",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_emerald: {
    key: "rank_emerald",
    name: "Emerald",
    requiredTurnover: 1500000,
    prerequisite: "1 Gold Left, 1 Gold Right, 7.50 Lakh side maintenance",
    fundPercentage: 1.0,
    fundAmount: 15000,
    rewards: "Emerald Ring / Gold Coin",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_platinum: {
    key: "rank_platinum",
    name: "Platinum",
    requiredTurnover: 3000000,
    prerequisite: "1 Emerald Left, 1 Emerald Right, 15 Lakh side maintenance",
    fundPercentage: 0.75,
    fundAmount: 22500,
    rewards: "Yamaha R15 V4 Bike",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_diamond: {
    key: "rank_diamond",
    name: "Diamond",
    requiredTurnover: 6000000,
    prerequisite: "1 Platinum Left, 1 Platinum Right, 30 Lakh side maintenance",
    fundPercentage: 0.50,
    fundAmount: 30000,
    rewards: "GFT Diamond Trophy & Cruise Tour",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_ruby: {
    key: "rank_ruby",
    name: "Ruby",
    requiredTurnover: 12000000,
    prerequisite: "1 Diamond Left, 1 Diamond Right, 60 Lakh side maintenance",
    fundPercentage: 0.25,
    fundAmount: 30000,
    rewards: "1-Week Thailand Tour",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
  rank_chairman: {
    key: "rank_chairman",
    name: "Chairman",
    requiredTurnover: 25000000,
    prerequisite: "1 Ruby Left, 1 Ruby Right, 1.20 Crore side maintenance, 3 Rubies for Dubai trip",
    fundPercentage: 1.0,
    fundAmount: 250000,
    rewards: "Dubai Luxury Tour",
    confirmationStatus: RULE_STATUS.CONFIRMED,
  },
});

/**
 * 10 Passive Turnover Tiers
 * Tier 8 contains an arithmetic mismatch in legacy source (₹17.5L * 12 = ₹2.10 Cr, not ₹21 L).
 */
export const PASSIVE_TIERS = Object.freeze([
  { tier: 1, turnover: 500000, monthlyAmount: 2000, yearlyAmount: 24000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 2, turnover: 1000000, monthlyAmount: 5000, yearlyAmount: 60000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 3, turnover: 5000000, monthlyAmount: 25000, yearlyAmount: 300000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 4, turnover: 10000000, monthlyAmount: 50000, yearlyAmount: 600000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 5, turnover: 25000000, monthlyAmount: 125000, yearlyAmount: 1500000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 6, turnover: 70000000, monthlyAmount: 350000, yearlyAmount: 4200000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 7, turnover: 150000000, monthlyAmount: 750000, yearlyAmount: 9000000, confirmationStatus: RULE_STATUS.CONFIRMED },
  {
    tier: 8,
    turnover: 350000000,
    monthlyAmount: 1750000,
    yearlyAmount: 2100000, // Discrepancy: source has ₹21 Lakh instead of ₹2.10 Crore
    expectedYearlyAmount: 21000000, // 1,750,000 * 12 = 21,000,000 (2.10 Crore)
    confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
    arithmeticMismatch: true,
    note: "REQUIRES CLIENT CONFIRMATION — ARITHMETIC MISMATCH: 17,50,000 * 12 = 2,10,00,000 (2.10 Crore), but source displayed 21,00,000.",
  },
  { tier: 9, turnover: 750000000, monthlyAmount: 3750000, yearlyAmount: 45000000, confirmationStatus: RULE_STATUS.CONFIRMED },
  { tier: 10, turnover: 1000000000, monthlyAmount: 5000000, yearlyAmount: 60000000, confirmationStatus: RULE_STATUS.CONFIRMED },
]);

/**
 * Operational Payout & Policy Calendars
 * Confirmed in Plan PDF Terms & Conditions.
 */
export const CALENDAR_RULES = Object.freeze({
  closingStartDay: 1,
  closingEndDay: 30,
  selfIncomeDays: [1, 11, 21],
  turnoverIncomeDay: 5,
  passiveIncomeDay: 7,
  referenceIncomeWindowHours: 24,
  lockInPeriodDays: 365,
  confirmationStatus: RULE_STATUS.CONFIRMED,
});

/**
 * Withdrawal Configuration
 * Prototype proposals pending client confirmation.
 */
export const WITHDRAWAL_CONFIG = Object.freeze({
  minWithdrawalINR: { value: 500, confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION },
  minWithdrawalUSDT: { value: 10, confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION },
  processingFeePercentage: { value: 5.0, confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION },
  supportedNetworks: { value: ["TRC20"], confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION },
});

/**
 * Helper: Retrieve rule configuration object by key.
 */
export function getRuleConfig(ruleKey) {
  if (PACKAGES[ruleKey]) return PACKAGES[ruleKey];
  if (REFERENCE_LEVELS[ruleKey]) return REFERENCE_LEVELS[ruleKey];
  if (RANKS[ruleKey]) return RANKS[ruleKey];
  if (ruleKey === "calendar_rules") return CALENDAR_RULES;
  if (WITHDRAWAL_CONFIG[ruleKey]) return WITHDRAWAL_CONFIG[ruleKey];
  return null;
}

/**
 * Execution Gatekeeper:
 * Evaluates whether a financial calculation rule is permitted for live execution.
 * 
 * STRICT MULTI-CONDITION POLICY:
 * To be executable, ALL of the following must be CONFIRMED:
 * 1. Global business plan status === CONFIRMED
 * 2. The specific rule's confirmationStatus === CONFIRMED
 * 3. Every dependent rule/package in `dependentKeys` must also have confirmationStatus === CONFIRMED
 * 
 * A global CONFIRMED status will NEVER override an unconfirmed package or dependent rule.
 */
export function isRuleExecutable(ruleKey, dependentKeys = []) {
  // Condition 1: Global status check
  if (BUSINESS_PLAN_STATUS !== RULE_STATUS.CONFIRMED) {
    return false;
  }

  // Condition 2: Specific rule status check
  const rule = getRuleConfig(ruleKey);
  if (!rule || rule.confirmationStatus !== RULE_STATUS.CONFIRMED) {
    return false;
  }

  // Condition 3 & 4: Dependent rules and calculation base status checks
  for (const depKey of dependentKeys) {
    const depRule = getRuleConfig(depKey);
    if (!depRule || depRule.confirmationStatus !== RULE_STATUS.CONFIRMED) {
      return false;
    }
  }

  return true;
}

/**
 * Enforce Rule Execution Gate:
 * Throws UnconfirmedBusinessRuleError if `isRuleExecutable` returns false.
 */
export function assertRuleExecutable(ruleKey, dependentKeys = []) {
  // Check global status
  if (BUSINESS_PLAN_STATUS !== RULE_STATUS.CONFIRMED) {
    throw new UnconfirmedBusinessRuleError(
      `Cannot execute live calculation: Global Business Plan status is '${BUSINESS_PLAN_STATUS}'. All live payouts are paused pending client confirmation.`,
      { ruleKey, globalStatus: BUSINESS_PLAN_STATUS }
    );
  }

  // Check specific rule
  const rule = getRuleConfig(ruleKey);
  if (!rule) {
    throw new UnconfirmedBusinessRuleError(
      `Unknown business rule key: '${ruleKey}'.`,
      { ruleKey }
    );
  }

  if (rule.confirmationStatus !== RULE_STATUS.CONFIRMED) {
    throw new UnconfirmedBusinessRuleError(
      `Cannot execute live calculation for unconfirmed rule '${ruleKey}'. Status: ${rule.confirmationStatus}.`,
      { ruleKey, status: rule.confirmationStatus, discrepancy: rule.discrepancy || null }
    );
  }

  // Check dependent rules
  for (const depKey of dependentKeys) {
    const depRule = getRuleConfig(depKey);
    if (!depRule || depRule.confirmationStatus !== RULE_STATUS.CONFIRMED) {
      throw new UnconfirmedBusinessRuleError(
        `Cannot execute rule '${ruleKey}': dependent rule '${depKey}' is not confirmed (Status: ${depRule ? depRule.confirmationStatus : "NOT_FOUND"}).`,
        { ruleKey, dependentKey: depKey, dependentStatus: depRule ? depRule.confirmationStatus : null }
      );
    }
  }

  return true;
}

/**
 * Passive Tiers Consistency Checker:
 * Validates that monthlyAmount * 12 === yearlyAmount across all 10 tiers.
 * Returns an array of detected discrepancies.
 */
export function validatePassiveTiersArithmetic() {
  const issues = [];
  for (const tier of PASSIVE_TIERS) {
    const calculatedYearly = tier.monthlyAmount * 12;
    if (calculatedYearly !== tier.yearlyAmount) {
      issues.push({
        tier: tier.tier,
        turnover: tier.turnover,
        monthlyAmount: tier.monthlyAmount,
        sourceYearlyAmount: tier.yearlyAmount,
        calculatedYearlyAmount: calculatedYearly,
        discrepancy: calculatedYearly - tier.yearlyAmount,
        message: `Tier ${tier.tier} arithmetic mismatch: monthly ₹${tier.monthlyAmount.toLocaleString()} * 12 = ₹${calculatedYearly.toLocaleString()}, but source records ₹${tier.yearlyAmount.toLocaleString()}.`,
      });
    }
  }
  return issues;
}
