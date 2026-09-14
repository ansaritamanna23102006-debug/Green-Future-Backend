/**
 * Green Future Tech (GFT) — Authoritative Income Calculation Engine
 * Phase 6: Safe Foundation for Income Engine
 * 
 * Flow:
 * Genealogy (User.sponsorId)
 *   ↓
 * Eligibility (incomeEligibilityService)
 *   ↓
 * Business Rule Resolution (businessPlanConfig & assertRuleExecutable)
 *   ↓
 * Income Calculation (Integer-Paisa Arithmetic)
 *   ↓
 * Immutable Calculation Snapshot (IncomeSnapshot)
 *   ↓
 * [STOP]
 * 
 * ABSOLUTE FINANCIAL ISOLATION:
 * ZERO wallet updates, ZERO journal entries, ZERO ledger postings, ZERO live payouts.
 */

import User from "../../models/User.js";
import IncomeSnapshot from "../../models/IncomeSnapshot.js";
import incomeEligibilityService from "./incomeEligibilityService.js";
import {
  INCOME_TYPES,
  ELIGIBILITY_STATUS,
  CALCULATION_STATUS,
  BASIS_POINTS_DIVISOR,
  MAX_SPONSOR_DEPTH,
} from "./incomeConstants.js";
import {
  RULE_VERSION,
  RULE_STATUS,
  REFERENCE_LEVELS,
  PACKAGES,
  PASSIVE_TIERS,
  isRuleExecutable,
} from "../../utils/rules/businessPlanConfig.js";
import { parseToPaisa, formatPaisaToRupees } from "../../utils/money.js";
import logger from "../../config/logger.js";
import AuditLog from "../../models/AuditLog.js";

// Mapping confirmed reference level percentages to integer basis points (1% = 100 bps)
const LEVEL_BASIS_POINTS = Object.freeze({
  1: 500, // 5.0%
  2: 300, // 3.0%
  3: 200, // 2.0%
  4: 150, // 1.5% (Discrepancy: unconfirmed)
  5: 100, // 1.0% (Discrepancy: unconfirmed)
});

class IncomeCalculationService {
  /**
   * Traverse unilevel sponsor hierarchy from a source user up to MAX_SPONSOR_DEPTH (5).
   * Strictly uses `User.sponsorId`. Cycle-protected via visited Set.
   * NEVER uses binary Genealogy placement.
   */
  async getSponsorHierarchy(sourceUserId, maxDepth = MAX_SPONSOR_DEPTH) {
    const hierarchy = [];
    const visited = new Set([sourceUserId]);
    let currentUserId = sourceUserId;
    let currentDepth = 1;

    while (currentDepth <= maxDepth) {
      const currentUser = await User.findOne({ userId: currentUserId }).lean();
      if (!currentUser || !currentUser.sponsorId || currentUser.sponsorId === "none") {
        break;
      }

      const sponsorId = currentUser.sponsorId;

      // Cycle & Self-sponsorship protection
      if (visited.has(sponsorId)) {
        logger.warn(`[INCOME ENGINE] Sponsor cycle detected during traversal: user ${sponsorId} already in chain.`);
        break;
      }

      const sponsorUser = await User.findOne({ userId: sponsorId }).lean();
      if (!sponsorUser) {
        logger.warn(`[INCOME ENGINE] Sponsor ${sponsorId} not found in database for user ${currentUserId}.`);
        break;
      }

      visited.add(sponsorId);
      hierarchy.push({
        level: currentDepth,
        sponsorUserId: sponsorUser.userId,
        status: sponsorUser.status,
        kycStatus: sponsorUser.kyc ? sponsorUser.kyc.status : "NOT_STARTED",
        activePackage: sponsorUser.activePackage || null,
      });

      currentUserId = sponsorId;
      currentDepth += 1;
    }

    return hierarchy;
  }

  /**
   * Deterministically calculate integer-paisa amount from base paisa and basis points.
   * Exact integer arithmetic: (baseAmountPaisa * basisPoints) / 10000.
   */
  calculatePaisaAmount(baseAmountPaisa, basisPoints) {
    if (typeof baseAmountPaisa !== "number" || !Number.isSafeInteger(baseAmountPaisa)) {
      throw new Error(`Invalid baseAmountPaisa: ${baseAmountPaisa}. Must be a safe integer.`);
    }
    if (baseAmountPaisa < 0) {
      throw new Error(`Negative baseAmountPaisa is not allowed: ${baseAmountPaisa}.`);
    }
    if (typeof basisPoints !== "number" || !Number.isSafeInteger(basisPoints)) {
      throw new Error(`Invalid basisPoints: ${basisPoints}. Must be a safe integer.`);
    }
    if (basisPoints < 0) {
      throw new Error(`Negative basisPoints are not allowed: ${basisPoints}.`);
    }

    // Integer arithmetic
    const product = baseAmountPaisa * basisPoints;
    if (!Number.isSafeInteger(product)) {
      throw new Error("Arithmetic overflow: Amount exceeds safe integer boundaries.");
    }

    return Math.floor(product / BASIS_POINTS_DIVISOR);
  }

  /**
   * Calculate Unilevel Reference Income across sponsor chain.
   * Gated:
   * 1. Reference Level rule (L1-L3 confirmed, L4-L5 requires confirmation)
   * 2. Package rule (All packages currently REQUIRES_CLIENT_CONFIRMATION)
   * 
   * If any dependent rule is unconfirmed, returns CALCULATION_BLOCKED without creating snapshots.
   */
  async calculateReferenceIncome({
    sourceUserId,
    baseAmountPaisa,
    packageId,
    periodKey = "DIRECT",
    dryRun = false,
  }) {
    if (!sourceUserId) throw new Error("sourceUserId is required.");
    if (typeof baseAmountPaisa !== "number" || baseAmountPaisa <= 0 || !Number.isSafeInteger(baseAmountPaisa)) {
      throw new Error(`Invalid baseAmountPaisa: ${baseAmountPaisa}. Must be a positive safe integer.`);
    }

    const pkg = PACKAGES[packageId];
    if (!pkg) {
      throw new Error(`Unknown packageId: '${packageId}'.`);
    }

    // Tier 1 Gate Check: Is package confirmed in Phase 0?
    // Since all 8 GFT packages are REQUIRES_CLIENT_CONFIRMATION, monetary execution is blocked.
    const isPackageConfirmed = pkg.confirmationStatus === RULE_STATUS.CONFIRMED;

    // Traverse unilevel sponsor hierarchy
    const sponsorChain = await this.getSponsorHierarchy(sourceUserId);
    const results = [];

    for (const link of sponsorChain) {
      const level = link.level;
      const beneficiaryUserId = link.sponsorUserId;
      const levelKey = `ref_l${level}`;
      const levelRule = REFERENCE_LEVELS[levelKey];
      const basisPoints = LEVEL_BASIS_POINTS[level] || 0;

      // Evaluate eligibility of this specific beneficiary
      const eligibility = await incomeEligibilityService.evaluateReferenceEligibility(
        beneficiaryUserId,
        sourceUserId,
        level
      );

      const calculatedAmountPaisa = this.calculatePaisaAmount(baseAmountPaisa, basisPoints);
      const idempotencyKey = `REF:${beneficiaryUserId}:${sourceUserId}:L${level}:${packageId}:${periodKey}:${RULE_VERSION}`;

      // Check if level rule or package rule is unconfirmed
      const isLevelConfirmed = levelRule && levelRule.confirmationStatus === RULE_STATUS.CONFIRMED;

      if (!isPackageConfirmed || !isLevelConfirmed || !eligibility.eligible) {
        results.push({
          level,
          beneficiaryUserId,
          sourceUserId,
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          status: CALCULATION_STATUS.CALCULATION_BLOCKED,
          reason: !eligibility.eligible
            ? eligibility.reason
            : !isLevelConfirmed
            ? `Reference Level ${level} rule requires client confirmation (status: ${levelRule ? levelRule.confirmationStatus : "UNKNOWN"}).`
            : `Package ${packageId} requires client confirmation (status: ${pkg.confirmationStatus}). Live calculation blocked.`,
          baseAmountPaisa,
          basisPoints,
          hypotheticalAmountPaisa: calculatedAmountPaisa,
          ruleKey: levelKey,
          ruleStatus: levelRule ? levelRule.confirmationStatus : "NOT_FOUND",
          packageStatus: pkg.confirmationStatus,
          idempotencyKey,
        });
        continue;
      }

      // Both Level rule and Package rule are CONFIRMED and user is ELIGIBLE!
      // In dry-run mode, return calculation without persisting snapshot
      if (dryRun) {
        results.push({
          level,
          beneficiaryUserId,
          sourceUserId,
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          status: CALCULATION_STATUS.PREVIEW,
          baseAmountPaisa,
          basisPoints,
          calculatedAmountPaisa,
          idempotencyKey,
          ruleVersion: RULE_VERSION,
          ruleStatus: RULE_STATUS.CONFIRMED,
        });
        continue;
      }

      // Check idempotency in DB
      const existingSnapshot = await IncomeSnapshot.findOne({ idempotencyKey });
      if (existingSnapshot) {
        results.push({
          level,
          beneficiaryUserId,
          sourceUserId,
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          status: CALCULATION_STATUS.CALCULATED,
          alreadyCalculated: true,
          snapshot: existingSnapshot,
        });
        continue;
      }

      // Persist immutable calculation snapshot
      try {
        const snapshot = await IncomeSnapshot.create({
          beneficiaryUserId,
          sourceUserId,
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          level,
          baseAmountPaisa,
          rateBasisPoints: basisPoints,
          calculatedAmountPaisa,
          idempotencyKey,
          ruleVersion: RULE_VERSION,
          ruleStatus: RULE_STATUS.CONFIRMED,
          genealogySnapshot: {
            sourceUserId,
            beneficiaryUserId,
            depth: level,
            sponsorChainLength: sponsorChain.length,
          },
          packageSnapshot: {
            packageId,
            name: pkg.name,
            baseAmountPaisa,
          },
        });

        results.push({
          level,
          beneficiaryUserId,
          sourceUserId,
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          status: CALCULATION_STATUS.CALCULATED,
          alreadyCalculated: false,
          snapshot,
        });
      } catch (err) {
        // Safe concurrency catch: if another worker inserted the same idempotencyKey concurrently
        if (err.code === 11000) {
          const concurrentSnapshot = await IncomeSnapshot.findOne({ idempotencyKey });
          results.push({
            level,
            beneficiaryUserId,
            sourceUserId,
            incomeType: INCOME_TYPES.REFERENCE_INCOME,
            status: CALCULATION_STATUS.CALCULATED,
            alreadyCalculated: true,
            snapshot: concurrentSnapshot,
          });
        } else {
          throw err;
        }
      }
    }

    return results;
  }

  /**
   * Preview calculation for authenticated user diagnostics.
   * NEVER mutates database, wallets, or ledgers.
   */
  async previewReferenceCalculation(userId, options = {}) {
    const user = await User.findOne({ userId });
    if (!user) throw new Error(`User '${userId}' not found.`);

    const hierarchy = await this.getSponsorHierarchy(userId);
    const ruleDiagnostics = Object.entries(REFERENCE_LEVELS).map(([key, config]) => ({
      level: config.level,
      percentage: config.percentage,
      basisPoints: LEVEL_BASIS_POINTS[config.level] || 0,
      confirmationStatus: config.confirmationStatus,
      isExecutable: config.confirmationStatus === RULE_STATUS.CONFIRMED,
      discrepancy: config.discrepancy || null,
    }));

    return {
      userId,
      sponsorHierarchy: hierarchy,
      ruleDiagnostics,
      packageCatalogStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
      notice: "Calculation engine is in safe audit mode. Zero wallet credits or live ledger postings are executed.",
    };
  }
}

const incomeCalculationService = new IncomeCalculationService();
export default incomeCalculationService;
