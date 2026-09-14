import incomeCalculationService from "../services/income/incomeCalculationService.js";
import incomeEligibilityService from "../services/income/incomeEligibilityService.js";
import {
  REFERENCE_LEVELS,
  RANKS,
  PASSIVE_TIERS,
  PACKAGES,
  BUSINESS_PLAN_STATUS,
  RULE_STATUS,
} from "../utils/rules/businessPlanConfig.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

/**
 * Get Authoritative Business Rule Status Matrix
 */
export const getIncomeRules = async (req, res, next) => {
  try {
    const rules = {
      globalStatus: BUSINESS_PLAN_STATUS,
      referenceLevels: REFERENCE_LEVELS,
      ranks: RANKS,
      passiveTiers: PASSIVE_TIERS,
      packageCatalogStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
      packages: PACKAGES,
      withdrawalStatus: {
        confirmationStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
        executable: false,
        note: "Withdrawal limits and fee structure are pending final business confirmation.",
      },
    };

    return successResponse(res, rules, "Authoritative business plan rule configuration fetched successfully.");
  } catch (error) {
    next(error);
  }
};

/**
 * Get Member Eligibility Diagnostics
 * Strictly evaluates req.user.userId. Ignores client-supplied userId.
 */
export const getMemberEligibility = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const diagnosis = await incomeEligibilityService.evaluateUserEligibility(userId);

    return successResponse(res, diagnosis, "Income eligibility diagnostics fetched successfully.");
  } catch (error) {
    next(error);
  }
};

/**
 * Get Member Income Calculation Preview (Read-Only)
 * Strictly evaluates req.user.userId. Ignores client-supplied financial values.
 */
export const getIncomePreview = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const preview = await incomeCalculationService.previewReferenceCalculation(userId);

    return successResponse(res, preview, "Safe income calculation preview generated successfully.");
  } catch (error) {
    next(error);
  }
};


