/**
 * Green Future Tech (GFT) — Income Engine Constants
 * Phase 6: Safe Foundation for Income Engine
 * 
 * Rules:
 * - Single source of truth for income types, eligibility statuses, and basis point scalers.
 * - Zero unconfirmed business rules hardcoded as executable values.
 */

export const INCOME_TYPES = Object.freeze({
  REFERENCE_INCOME: "REFERENCE_INCOME",
  SELF_INCOME: "SELF_INCOME",
  RANK_TURNOVER: "RANK_TURNOVER",
  PASSIVE_TURNOVER: "PASSIVE_TURNOVER",
});

export const ELIGIBILITY_STATUS = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  INELIGIBLE: "INELIGIBLE",
  CALCULATION_BLOCKED: "CALCULATION_BLOCKED",
  INVALID_INPUT: "INVALID_INPUT",
});

export const CALCULATION_STATUS = Object.freeze({
  CALCULATED: "CALCULATED",
  CALCULATION_BLOCKED: "CALCULATION_BLOCKED",
  PREVIEW: "PREVIEW",
});

export const POSTING_STATUS = Object.freeze({
  POSTING_PENDING: "POSTING_PENDING",
  POSTED: "POSTED",
  ALREADY_POSTED: "ALREADY_POSTED",
  POSTING_BLOCKED: "POSTING_BLOCKED",
  POSTING_FAILED: "POSTING_FAILED",
});

export const POSTING_AUDIT_ACTIONS = Object.freeze({
  INCOME_POSTING_STARTED: "INCOME_POSTING_STARTED",
  INCOME_POSTING_COMPLETED: "INCOME_POSTING_COMPLETED",
  INCOME_POSTING_BLOCKED: "INCOME_POSTING_BLOCKED",
  INCOME_POSTING_DUPLICATE: "INCOME_POSTING_DUPLICATE",
  INCOME_POSTING_FAILED: "INCOME_POSTING_FAILED",
});

// Basis points scaler: 1% = 100 bps, 100% = 10,000 bps
export const BASIS_POINTS_DIVISOR = 10000;

// Maximum sponsor tree hierarchy traversal depth for unilevel reference calculation
export const MAX_SPONSOR_DEPTH = 5;

