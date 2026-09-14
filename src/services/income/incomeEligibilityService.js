import User from "../../models/User.js";
import {
  ELIGIBILITY_STATUS,
  MAX_SPONSOR_DEPTH,
} from "./incomeConstants.js";
import {
  REFERENCE_LEVELS,
  RULE_STATUS,
  isRuleExecutable,
} from "../../utils/rules/businessPlanConfig.js";
import { KYC_STATUS } from "../../utils/rules/kycConstants.js";

class IncomeEligibilityService {
  /**
   * Evaluate basic user eligibility for income participation.
   * A user must be active, KYC-approved, and possess an active package.
   */
  async evaluateUserEligibility(userId) {
    if (!userId) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: "User ID is required.",
      };
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: `User '${userId}' does not exist.`,
      };
    }

    if (user.status !== "active") {
      return {
        status: ELIGIBILITY_STATUS.INELIGIBLE,
        eligible: false,
        reason: `User '${userId}' status is '${user.status}', must be 'active'.`,
        user,
      };
    }

    const isKycApproved = user.kyc && user.kyc.status === KYC_STATUS.APPROVED;
    if (!isKycApproved) {
      return {
        status: ELIGIBILITY_STATUS.INELIGIBLE,
        eligible: false,
        reason: `User '${userId}' KYC status is '${user.kyc ? user.kyc.status : "NOT_STARTED"}'. KYC approval is required.`,
        user,
      };
    }

    const hasActivePackage = user.activePackage && user.activePackage.status === "ACTIVE";
    if (!hasActivePackage) {
      return {
        status: ELIGIBILITY_STATUS.INELIGIBLE,
        eligible: false,
        reason: `User '${userId}' does not have an active package.`,
        user,
      };
    }

    return {
      status: ELIGIBILITY_STATUS.ELIGIBLE,
      eligible: true,
      user,
    };
  }

  /**
   * Evaluate unilevel reference income eligibility between source downline and beneficiary sponsor.
   */
  async evaluateReferenceEligibility(beneficiaryUserId, sourceUserId, level) {
    if (!beneficiaryUserId || !sourceUserId) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: "Both beneficiaryUserId and sourceUserId are required.",
      };
    }

    if (beneficiaryUserId === sourceUserId) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: "Self-sponsorship is strictly invalid. Beneficiary cannot be the source user.",
      };
    }

    const numericLevel = Number(level);
    if (!Number.isInteger(numericLevel) || numericLevel < 1 || numericLevel > MAX_SPONSOR_DEPTH) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: `Invalid reference level: ${level}. Must be an integer between 1 and ${MAX_SPONSOR_DEPTH}.`,
      };
    }

    // Evaluate beneficiary user standing
    const beneficiaryCheck = await this.evaluateUserEligibility(beneficiaryUserId);
    if (!beneficiaryCheck.eligible) {
      return beneficiaryCheck;
    }

    // Evaluate source user existence & activity
    const sourceUser = await User.findOne({ userId: sourceUserId });
    if (!sourceUser) {
      return {
        status: ELIGIBILITY_STATUS.INVALID_INPUT,
        eligible: false,
        reason: `Source user '${sourceUserId}' not found.`,
      };
    }

    if (sourceUser.status !== "active") {
      return {
        status: ELIGIBILITY_STATUS.INELIGIBLE,
        eligible: false,
        reason: `Source user '${sourceUserId}' is not active.`,
      };
    }

    // Evaluate business rule gate for this level
    const levelKey = `ref_l${numericLevel}`;
    const levelRule = REFERENCE_LEVELS[levelKey];
    if (!levelRule) {
      return {
        status: ELIGIBILITY_STATUS.CALCULATION_BLOCKED,
        eligible: false,
        reason: `Unconfigured reference level rule: '${levelKey}'.`,
      };
    }

    if (levelRule.confirmationStatus !== RULE_STATUS.CONFIRMED) {
      return {
        status: ELIGIBILITY_STATUS.CALCULATION_BLOCKED,
        eligible: false,
        reason: `Reference level rule '${levelKey}' status is '${levelRule.confirmationStatus}'. Calculation blocked pending client confirmation.`,
        ruleKey: levelKey,
        ruleStatus: levelRule.confirmationStatus,
      };
    }

    return {
      status: ELIGIBILITY_STATUS.ELIGIBLE,
      eligible: true,
      beneficiary: beneficiaryCheck.user,
      source: sourceUser,
      levelRule,
    };
  }
}

export default new IncomeEligibilityService();
