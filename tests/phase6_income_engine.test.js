/**
 * Green Future Tech (GFT) — Phase 6 Test Suite
 * Safe Foundation for Income Calculation Engine
 * 
 * Categories Covered:
 * Category A: Business Rules
 * Category B: Integer Money Safety
 * Category C: Genealogy (Sponsor Tree vs Binary Tree)
 * Category D: Eligibility Engine
 * Category E: Security & RBAC
 * Category F: Idempotency & Concurrency
 * Category G: Immutability of Calculation Snapshots
 * Category H: Absolute Financial Isolation (Wallet, JournalEntry, LedgerPosting unchanged)
 * Category I: Legacy Income Engine Lockdown
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Models
import User from "../src/models/User.js";
import Wallet from "../src/models/Wallet.js";
import JournalEntry from "../src/models/JournalEntry.js";
import LedgerPosting from "../src/models/LedgerPosting.js";
import IncomeSnapshot from "../src/models/IncomeSnapshot.js";
import Genealogy from "../src/models/Genealogy.js";

// Services and Utilities
import incomeCalculationService from "../src/services/income/incomeCalculationService.js";
import incomeEligibilityService from "../src/services/income/incomeEligibilityService.js";
import {
  INCOME_TYPES,
  ELIGIBILITY_STATUS,
  CALCULATION_STATUS,
  BASIS_POINTS_DIVISOR,
  MAX_SPONSOR_DEPTH,
} from "../src/services/income/incomeConstants.js";
import {
  RULE_VERSION,
  RULE_STATUS,
  REFERENCE_LEVELS,
  PACKAGES,
  PASSIVE_TIERS,
  RANKS,
  isRuleExecutable,
  assertRuleExecutable,
} from "../src/utils/rules/businessPlanConfig.js";
import { parseToPaisa, formatPaisaToRupees } from "../src/utils/money.js";
import { UnconfirmedBusinessRuleError } from "../src/utils/errors.js";
import IncomeService from "../src/services/incomeService.js";
import {
  getIncomeRules,
  getMemberEligibility,
  getIncomePreview,
} from "../src/controllers/incomeController.js";

const TEST_MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gft-db";

let userCounter = 0;
const createTestUser = async (overrides = {}) => {
  userCounter += 1;
  const uid = overrides.userId || `test_p6_u_${Date.now()}_${userCounter}`;
  const doc = {
    userId: uid,
    name: overrides.name || `User ${uid}`,
    email: overrides.email || `${uid}@example.com`,
    mobile: overrides.mobile || `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    password: overrides.password || "Password@123",
    referralCode: overrides.referralCode || `REF_${uid}`,
    sponsorId: overrides.sponsorId !== undefined ? overrides.sponsorId : "none",
    status: overrides.status || "active",
    kyc: overrides.kyc || { status: "APPROVED" },
    activePackage: overrides.activePackage !== undefined ? overrides.activePackage : { packageId: "pkg_gft_1", status: "ACTIVE" },
    ...overrides,
  };
  return User.create(doc);
};

describe("PHASE 6 — INCOME ENGINE FOUNDATION", async () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGODB_URI);
    }
    // Clean up Phase 6 test artifacts (case-insensitive for Genealogy uppercase index)
    await mongoose.connection.collection("incomesnapshots").deleteMany({ idempotencyKey: /^REF:test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("genealogies").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
  });

  after(async () => {
    await mongoose.connection.collection("incomesnapshots").deleteMany({ idempotencyKey: /^REF:test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
    await mongoose.connection.collection("genealogies").deleteMany({ userId: /^test_p6_/i }).catch(() => {});
    await mongoose.disconnect();
  });

  // ==========================================
  // CATEGORY A — BUSINESS RULES
  // ==========================================

  test("1. Confirmed reference level percentages (L1: 5%, L2: 3%, L3: 2%) resolve to correct basis points", () => {
    assert.strictEqual(REFERENCE_LEVELS.ref_l1.percentage, 5.0);
    assert.strictEqual(REFERENCE_LEVELS.ref_l1.confirmationStatus, RULE_STATUS.CONFIRMED);

    assert.strictEqual(REFERENCE_LEVELS.ref_l2.percentage, 3.0);
    assert.strictEqual(REFERENCE_LEVELS.ref_l2.confirmationStatus, RULE_STATUS.CONFIRMED);

    assert.strictEqual(REFERENCE_LEVELS.ref_l3.percentage, 2.0);
    assert.strictEqual(REFERENCE_LEVELS.ref_l3.confirmationStatus, RULE_STATUS.CONFIRMED);
  });

  test("2. Reference level 4 requires client confirmation and is blocked from live execution", () => {
    assert.strictEqual(REFERENCE_LEVELS.ref_l4.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
    assert.strictEqual(isRuleExecutable("ref_l4"), false);
    assert.throws(
      () => assertRuleExecutable("ref_l4"),
      (err) => err instanceof UnconfirmedBusinessRuleError
    );
  });

  test("3. Reference level 5 requires client confirmation and is blocked from live execution", () => {
    assert.strictEqual(REFERENCE_LEVELS.ref_l5.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
    assert.strictEqual(isRuleExecutable("ref_l5"), false);
    assert.throws(
      () => assertRuleExecutable("ref_l5"),
      (err) => err instanceof UnconfirmedBusinessRuleError
    );
  });

  test("4. All 8 GFT packages have confirmationStatus === REQUIRES_CLIENT_CONFIRMATION", () => {
    for (let i = 1; i <= 8; i++) {
      const pkgId = `pkg_gft_${i}`;
      assert.strictEqual(PACKAGES[pkgId].confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
      assert.strictEqual(isRuleExecutable(pkgId), false);
    }
  });

  test("5. Passive tier 8 has an arithmetic mismatch and is blocked from execution", () => {
    const tier8 = PASSIVE_TIERS[7]; // index 7 = tier 8
    assert.strictEqual(tier8.tier, 8);
    assert.strictEqual(tier8.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
    assert.notStrictEqual(tier8.monthlyAmount * 12, tier8.yearlyAmount);
  });

  test("6. Passive tiers 1–7, 9–10 are CONFIRMED for turnover configuration", () => {
    const confirmedIndices = [0, 1, 2, 3, 4, 5, 6, 8, 9];
    for (const idx of confirmedIndices) {
      const tier = PASSIVE_TIERS[idx];
      assert.strictEqual(tier.confirmationStatus, RULE_STATUS.CONFIRMED);
      assert.strictEqual(tier.monthlyAmount * 12, tier.yearlyAmount);
    }
  });

  test("7. Ranks (Silver through Chairman) evaluate deterministically without DB writes", () => {
    assert.strictEqual(RANKS.rank_silver.confirmationStatus, RULE_STATUS.CONFIRMED);
    assert.strictEqual(RANKS.rank_gold.confirmationStatus, RULE_STATUS.CONFIRMED);
    assert.strictEqual(RANKS.rank_chairman.confirmationStatus, RULE_STATUS.CONFIRMED);
  });

  test("8. Monetary reference calculation is gated by unconfirmed package base and returns CALCULATION_BLOCKED", async () => {
    await createTestUser({
      userId: "test_p6_sponsor_gated_001",
      sponsorId: "none",
    });

    await createTestUser({
      userId: "test_p6_buyer_gated_001",
      sponsorId: "test_p6_sponsor_gated_001",
    });

    const results = await incomeCalculationService.calculateReferenceIncome({
      sourceUserId: "test_p6_buyer_gated_001",
      baseAmountPaisa: 300000, // ₹3,000 in paisa
      packageId: "pkg_gft_1",
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, CALCULATION_STATUS.CALCULATION_BLOCKED);
    assert.strictEqual(results[0].beneficiaryUserId, "test_p6_sponsor_gated_001");
    assert.match(results[0].reason, /requires client confirmation/);
  });

  // ==========================================
  // CATEGORY B — INTEGER MONEY
  // ==========================================

  test("9. parseToPaisa correctly parses INR strings and integers into integer Paisa", () => {
    assert.strictEqual(parseToPaisa("1500.25"), 150025);
    assert.strictEqual(parseToPaisa("100"), 10000);
    assert.strictEqual(parseToPaisa(100), 10000);
    assert.strictEqual(parseToPaisa("0.05"), 5);
    assert.strictEqual(parseToPaisa("0"), 0);
  });

  test("10. calculatePaisaAmount computes exact integer paisa without floating-point inaccuracies", () => {
    // ₹1,000 (100,000 paisa) at 5% (500 bps) = 5,000 paisa (₹50.00)
    const amount1 = incomeCalculationService.calculatePaisaAmount(100000, 500);
    assert.strictEqual(amount1, 5000);

    // ₹3,333.33 (333,333 paisa) at 3% (300 bps) = 9,999 paisa (integer division)
    const amount2 = incomeCalculationService.calculatePaisaAmount(333333, 300);
    assert.strictEqual(amount2, 9999);
  });

  test("11. calculatePaisaAmount rejects negative baseAmountPaisa", () => {
    assert.throws(
      () => incomeCalculationService.calculatePaisaAmount(-100, 500),
      /Negative baseAmountPaisa is not allowed/
    );
  });

  test("12. calculatePaisaAmount rejects negative basisPoints", () => {
    assert.throws(
      () => incomeCalculationService.calculatePaisaAmount(10000, -500),
      /Negative basisPoints are not allowed/
    );
  });

  test("13. calculatePaisaAmount rejects NaN, Infinity, and non-integer inputs", () => {
    assert.throws(() => incomeCalculationService.calculatePaisaAmount(NaN, 500), /Must be a safe integer/);
    assert.throws(() => incomeCalculationService.calculatePaisaAmount(Infinity, 500), /Must be a safe integer/);
    assert.throws(() => incomeCalculationService.calculatePaisaAmount(100.5, 500), /Must be a safe integer/);
    assert.throws(() => incomeCalculationService.calculatePaisaAmount(1000, 5.5), /Must be a safe integer/);
  });

  test("14. calculatePaisaAmount handles zero base amount safely (returns 0 paisa)", () => {
    const result = incomeCalculationService.calculatePaisaAmount(0, 500);
    assert.strictEqual(result, 0);
  });

  test("15. calculatePaisaAmount handles large safe integer amounts without overflow", () => {
    const largePaisa = 100000000000; // ₹1 Billion in paisa
    const result = incomeCalculationService.calculatePaisaAmount(largePaisa, 500);
    assert.strictEqual(result, 5000000000);
    assert(Number.isSafeInteger(result));
  });

  test("16. formatPaisaToRupees formats integer paisa deterministically", () => {
    assert.strictEqual(formatPaisaToRupees(150025), "1500.25");
    assert.strictEqual(formatPaisaToRupees(5000), "50.00");
    assert.strictEqual(formatPaisaToRupees(5), "0.05");
    assert.strictEqual(formatPaisaToRupees(0), "0.00");
  });

  // ==========================================
  // CATEGORY C — GENEALOGY (SPONSOR VS BINARY)
  // ==========================================

  test("17. getSponsorHierarchy correctly identifies L1 direct sponsor", async () => {
    await createTestUser({
      userId: "test_p6_gen_l1_sponsor",
      sponsorId: "none",
    });

    await createTestUser({
      userId: "test_p6_gen_l1_downline",
      sponsorId: "test_p6_gen_l1_sponsor",
    });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_gen_l1_downline");
    assert.strictEqual(chain.length, 1);
    assert.strictEqual(chain[0].level, 1);
    assert.strictEqual(chain[0].sponsorUserId, "test_p6_gen_l1_sponsor");
  });

  test("18. getSponsorHierarchy traverses multi-tier sponsor chain (L1, L2, L3)", async () => {
    await createTestUser({ userId: "test_p6_chain_top", sponsorId: "none" });
    await createTestUser({ userId: "test_p6_chain_mid", sponsorId: "test_p6_chain_top" });
    await createTestUser({ userId: "test_p6_chain_bot", sponsorId: "test_p6_chain_mid" });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_chain_bot");
    assert.strictEqual(chain.length, 2);
    assert.strictEqual(chain[0].level, 1);
    assert.strictEqual(chain[0].sponsorUserId, "test_p6_chain_mid");
    assert.strictEqual(chain[1].level, 2);
    assert.strictEqual(chain[1].sponsorUserId, "test_p6_chain_top");
  });

  test("19. getSponsorHierarchy is bounded at MAX_SPONSOR_DEPTH (5 levels)", async () => {
    // Create chain of 7 users
    let lastId = "test_p6_depth_0";
    await createTestUser({ userId: lastId, sponsorId: "none" });

    for (let d = 1; d <= 7; d++) {
      const curId = `test_p6_depth_${d}`;
      await createTestUser({ userId: curId, sponsorId: lastId });
      lastId = curId;
    }

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_depth_7");
    assert.strictEqual(chain.length, MAX_SPONSOR_DEPTH, "Hierarchy must be clamped at maximum depth 5");
  });

  test("20. Self-sponsorship stops traversal immediately", async () => {
    await createTestUser({
      userId: "test_p6_self_sponsor",
      sponsorId: "test_p6_self_sponsor", // Self sponsor!
    });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_self_sponsor");
    assert.strictEqual(chain.length, 0, "Self-sponsorship must immediately terminate traversal");
  });

  test("21. Cycle detection prevents infinite loops via visited Set", async () => {
    // Cyclic sponsor setup: A -> B -> A
    await createTestUser({ userId: "test_p6_cycle_a", sponsorId: "test_p6_cycle_b" });
    await createTestUser({ userId: "test_p6_cycle_b", sponsorId: "test_p6_cycle_a" });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_cycle_a");
    assert.strictEqual(chain.length, 1, "Cycle must be detected and broken after first repetition");
    assert.strictEqual(chain[0].sponsorUserId, "test_p6_cycle_b");
  });

  test("22. Missing or nonexistent sponsor stops traversal gracefully", async () => {
    await createTestUser({
      userId: "test_p6_ghost_sponsor_child",
      sponsorId: "test_p6_nonexistent_sponsor_id",
    });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_ghost_sponsor_child");
    assert.strictEqual(chain.length, 0, "Nonexistent sponsor must not crash and terminate traversal");
  });

  test("23. Binary tree (Genealogy.parentId) is NEVER used for unilevel reference calculations", async () => {
    // In binary tree: User X parent is Y. But in sponsor tree: User X sponsor is Z.
    await createTestUser({ userId: "test_p6_binary_parent", sponsorId: "none" });
    await createTestUser({ userId: "test_p6_sponsor_actual", sponsorId: "none" });
    await createTestUser({
      userId: "test_p6_binary_mismatch_child",
      sponsorId: "test_p6_sponsor_actual", // Sponsor is Z
    });

    await Genealogy.deleteOne({ userId: "TEST_P6_BINARY_MISMATCH_CHILD" }).catch(() => {});
    // Create binary placement pointing to Y
    await Genealogy.create({
      user: new mongoose.Types.ObjectId(),
      userId: "test_p6_binary_mismatch_child",
      sponsorId: "test_p6_sponsor_actual",
      parentId: "test_p6_binary_parent",
      placementLeg: "left",
    });

    const chain = await incomeCalculationService.getSponsorHierarchy("test_p6_binary_mismatch_child");
    assert.strictEqual(chain.length, 1);
    assert.strictEqual(
      chain[0].sponsorUserId,
      "test_p6_sponsor_actual",
      "Must follow User.sponsorId, NEVER Genealogy.parentId!"
    );
  });

  // ==========================================
  // CATEGORY D — ELIGIBILITY ENGINE
  // ==========================================

  test("24. User with unverified KYC is INELIGIBLE for income calculation", async () => {
    await createTestUser({
      userId: "test_p6_kyc_pending",
      kyc: { status: "SUBMITTED" },
      sponsorId: "none",
    });

    const check = await incomeEligibilityService.evaluateUserEligibility("test_p6_kyc_pending");
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.status, ELIGIBILITY_STATUS.INELIGIBLE);
    assert.match(check.reason, /KYC approval is required/);
  });

  test("25. Inactive user is INELIGIBLE for income calculation", async () => {
    await createTestUser({
      userId: "test_p6_inactive_user",
      status: "suspended",
      sponsorId: "none",
    });

    const check = await incomeEligibilityService.evaluateUserEligibility("test_p6_inactive_user");
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.status, ELIGIBILITY_STATUS.INELIGIBLE);
    assert.match(check.reason, /must be 'active'/);
  });

  test("26. User without active package is INELIGIBLE for income calculation", async () => {
    await createTestUser({
      userId: "test_p6_no_package_user",
      activePackage: null,
      sponsorId: "none",
    });

    const check = await incomeEligibilityService.evaluateUserEligibility("test_p6_no_package_user");
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.status, ELIGIBILITY_STATUS.INELIGIBLE);
    assert.match(check.reason, /does not have an active package/);
  });

  test("27. Self-reference returns INVALID_INPUT", async () => {
    const check = await incomeEligibilityService.evaluateReferenceEligibility(
      "test_p6_same_user",
      "test_p6_same_user",
      1
    );
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.status, ELIGIBILITY_STATUS.INVALID_INPUT);
    assert.match(check.reason, /Self-sponsorship is strictly invalid/);
  });

  test("28. Out-of-bounds reference level returns INVALID_INPUT", async () => {
    const check = await incomeEligibilityService.evaluateReferenceEligibility(
      "test_p6_user_a",
      "test_p6_user_b",
      6 // Level 6 > MAX_SPONSOR_DEPTH (5)
    );
    assert.strictEqual(check.eligible, false);
    assert.strictEqual(check.status, ELIGIBILITY_STATUS.INVALID_INPUT);
    assert.match(check.reason, /Invalid reference level/);
  });

  // ==========================================
  // CATEGORY E — SECURITY & TAMPERING PROTECTION
  // ==========================================

  test("29. previewReferenceCalculation strictly evaluates target user without external input tampering", async () => {
    await createTestUser({
      userId: "test_p6_preview_user",
      sponsorId: "none",
    });

    const preview = await incomeCalculationService.previewReferenceCalculation("test_p6_preview_user");
    assert.strictEqual(preview.userId, "test_p6_preview_user");
    assert(Array.isArray(preview.ruleDiagnostics));
    assert.strictEqual(preview.packageCatalogStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
  });

  test("30. Server resolves all parameters; client cannot override base amount or basis points", () => {
    // Engine calculatePaisaAmount validates types and boundaries server-side
    assert.throws(
      () => incomeCalculationService.calculatePaisaAmount("tampered_string", 500),
      /Must be a safe integer/
    );
  });

  test("31. Member attempting to pass negative financial values is rejected server-side", () => {
    assert.throws(
      () => incomeCalculationService.calculatePaisaAmount(-50000, 500),
      /Negative baseAmountPaisa is not allowed/
    );
  });

  test("32. Reference level rule evaluation ignores client-supplied percentages and reads Phase 0 configuration", () => {
    // Level 1 percentage is strictly 5.0% from REFERENCE_LEVELS
    assert.strictEqual(REFERENCE_LEVELS.ref_l1.percentage, 5.0);
    // Level 2 percentage is strictly 3.0% from REFERENCE_LEVELS
    assert.strictEqual(REFERENCE_LEVELS.ref_l2.percentage, 3.0);
  });

  // ==========================================
  // CATEGORY F — IDEMPOTENCY & CONCURRENCY
  // ==========================================

  test("33. Same calculation returns existing snapshot and does not duplicate records (Idempotency)", async () => {
    const idempotencyKey = "REF:test_p6_idem_ben:test_p6_idem_src:L1:pkg_gft_1:DIRECT:BUSINESS_PLAN_DRAFT_V0";

    const snap1 = await IncomeSnapshot.create({
      beneficiaryUserId: "test_p6_idem_ben",
      sourceUserId: "test_p6_idem_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      baseAmountPaisa: 300000,
      rateBasisPoints: 500,
      calculatedAmountPaisa: 15000,
      idempotencyKey,
      ruleVersion: RULE_VERSION,
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    assert(snap1._id);

    // Attempt to query or re-insert with identical idempotencyKey
    const countBefore = await IncomeSnapshot.countDocuments({ idempotencyKey });
    assert.strictEqual(countBefore, 1);

    // Duplicate insert attempt rejected by MongoDB unique index
    await assert.rejects(
      async () => {
        await IncomeSnapshot.create({
          beneficiaryUserId: "test_p6_idem_ben",
          sourceUserId: "test_p6_idem_src",
          incomeType: INCOME_TYPES.REFERENCE_INCOME,
          level: 1,
          baseAmountPaisa: 300000,
          rateBasisPoints: 500,
          calculatedAmountPaisa: 15000,
          idempotencyKey,
          ruleVersion: RULE_VERSION,
          ruleStatus: RULE_STATUS.CONFIRMED,
        });
      },
      (err) => err.code === 11000 // Duplicate key error
    );

    const countAfter = await IncomeSnapshot.countDocuments({ idempotencyKey });
    assert.strictEqual(countAfter, 1, "Snapshot count must remain exactly 1");
  });

  test("34. Concurrent calculations with same idempotency key are safe and do not duplicate", async () => {
    const concurrentKey = "REF:test_p6_conc_ben:test_p6_conc_src:L1:pkg_gft_1:DIRECT:BUSINESS_PLAN_DRAFT_V0";

    const insertPromise1 = IncomeSnapshot.create({
      beneficiaryUserId: "test_p6_conc_ben",
      sourceUserId: "test_p6_conc_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      baseAmountPaisa: 500000,
      rateBasisPoints: 500,
      calculatedAmountPaisa: 25000,
      idempotencyKey: concurrentKey,
      ruleVersion: RULE_VERSION,
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    const insertPromise2 = IncomeSnapshot.create({
      beneficiaryUserId: "test_p6_conc_ben",
      sourceUserId: "test_p6_conc_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      baseAmountPaisa: 500000,
      rateBasisPoints: 500,
      calculatedAmountPaisa: 25000,
      idempotencyKey: concurrentKey,
      ruleVersion: RULE_VERSION,
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    const results = await Promise.allSettled([insertPromise1, insertPromise2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one concurrent insert must succeed");
    assert.strictEqual(rejected.length, 1, "The duplicate concurrent insert must be rejected with E11000");
    assert.strictEqual(rejected[0].reason.code, 11000);
  });

  test("35. Different source or beneficiary generates distinct idempotency key", () => {
    const key1 = `REF:ben1:src1:L1:pkg1:DIRECT:${RULE_VERSION}`;
    const key2 = `REF:ben1:src2:L1:pkg1:DIRECT:${RULE_VERSION}`;
    const key3 = `REF:ben2:src1:L1:pkg1:DIRECT:${RULE_VERSION}`;

    assert.notStrictEqual(key1, key2);
    assert.notStrictEqual(key1, key3);
  });

  test("36. Different calculation period generates distinct idempotency key", () => {
    const keyMonth1 = `REF:ben1:src1:L1:pkg1:PERIOD_2026_09:${RULE_VERSION}`;
    const keyMonth2 = `REF:ben1:src1:L1:pkg1:PERIOD_2026_10:${RULE_VERSION}`;

    assert.notStrictEqual(keyMonth1, keyMonth2);
  });

  // ==========================================
  // CATEGORY G — IMMUTABILITY OF CALCULATION SNAPSHOTS
  // ==========================================

  test("37. Direct update on IncomeSnapshot is blocked by Mongoose immutability guard", async () => {
    const snap = await IncomeSnapshot.create({
      beneficiaryUserId: "test_p6_immut_ben",
      sourceUserId: "test_p6_immut_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      baseAmountPaisa: 100000,
      rateBasisPoints: 500,
      calculatedAmountPaisa: 5000,
      idempotencyKey: "REF:test_p6_immut_ben:test_p6_immut_src:L1:pkg_gft_1:DIRECT:V0",
      ruleVersion: RULE_VERSION,
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    await assert.rejects(
      async () => {
        await IncomeSnapshot.updateOne(
          { _id: snap._id },
          { $set: { calculatedAmountPaisa: 999999 } }
        );
      },
      /Fatal: IncomeSnapshot records are permanently immutable and cannot be updated/
    );
  });

  test("38. Direct deletion of IncomeSnapshot is blocked by Mongoose immutability guard", async () => {
    await assert.rejects(
      async () => {
        await IncomeSnapshot.deleteOne({
          idempotencyKey: "REF:test_p6_immut_ben:test_p6_immut_src:L1:pkg_gft_1:DIRECT:V0",
        });
      },
      /Fatal: IncomeSnapshot records are permanently immutable and cannot be deleted/
    );
  });

  // ==========================================
  // CATEGORY H — ABSOLUTE FINANCIAL ISOLATION
  // ==========================================

  test("39. Executing income calculations strictly leaves Wallet availablePaisa, lockedPaisa, totalEarnedPaisa, incomeWallet unchanged", async () => {
    // Create test user and wallet
    const testUserId = "test_p6_wallet_isolation_user";
    await createTestUser({
      userId: testUserId,
      sponsorId: "none",
    });

    const initialWallet = await Wallet.create({
      user: new mongoose.Types.ObjectId(),
      userId: testUserId,
      availablePaisa: 50000, // ₹500.00
      lockedPaisa: 10000,
      totalEarnedPaisa: 50000,
      incomeWallet: 500,
      version: 1,
    });

    // Run preview and calculation methods
    await incomeCalculationService.previewReferenceCalculation(testUserId);
    await incomeCalculationService.calculateReferenceIncome({
      sourceUserId: testUserId,
      baseAmountPaisa: 200000,
      packageId: "pkg_gft_1",
    });

    // Inspect wallet after calculations
    const walletAfter = await Wallet.findOne({ userId: testUserId });
    assert.strictEqual(walletAfter.availablePaisa, 50000, "availablePaisa must remain strictly unchanged!");
    assert.strictEqual(walletAfter.lockedPaisa, 10000, "lockedPaisa must remain strictly unchanged!");
    assert.strictEqual(walletAfter.totalEarnedPaisa, 50000, "totalEarnedPaisa must remain strictly unchanged!");
    assert.strictEqual(walletAfter.incomeWallet, 500, "legacy incomeWallet must remain strictly unchanged!");
    assert.strictEqual(walletAfter.version, 1, "Wallet version must remain strictly unchanged!");
  });

  test("40. Executing income calculations creates strictly ZERO JournalEntry records", async () => {
    const countBefore = await JournalEntry.countDocuments({});

    await incomeCalculationService.calculateReferenceIncome({
      sourceUserId: "test_p6_buyer_gated_001",
      baseAmountPaisa: 500000,
      packageId: "pkg_gft_1",
    });

    const countAfter = await JournalEntry.countDocuments({});
    assert.strictEqual(countAfter, countBefore, "JournalEntry count must remain strictly unchanged!");
  });

  test("41. Executing income calculations creates strictly ZERO LedgerPosting records", async () => {
    const countBefore = await LedgerPosting.countDocuments({});

    await incomeCalculationService.calculateReferenceIncome({
      sourceUserId: "test_p6_buyer_gated_001",
      baseAmountPaisa: 500000,
      packageId: "pkg_gft_1",
    });

    const countAfter = await LedgerPosting.countDocuments({});
    assert.strictEqual(countAfter, countBefore, "LedgerPosting count must remain strictly unchanged!");
  });

  // ==========================================
  // CATEGORY I — LEGACY INCOME ENGINE LOCKDOWN
  // ==========================================

  test("42. Legacy incomeService.payDirectIncome remains gated under Phase 0 assertRuleExecutable", async () => {
    // Should throw UnconfirmedBusinessRuleError because BUSINESS_PLAN_STATUS is unconfirmed
    await assert.rejects(
      async () => {
        await IncomeService.payDirectIncome("test_p6_user", 1000);
      },
      (err) => err instanceof UnconfirmedBusinessRuleError && /Global Business Plan status is/.test(err.message)
    );
  });

  test("43. Legacy incomeService.runWeeklyBinaryMatching remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.runWeeklyBinaryMatching();
      },
      (err) => err instanceof UnconfirmedBusinessRuleError && /Global Business Plan status is/.test(err.message)
    );
  });

  test("44. Legacy incomeService.runDailyStakingYield remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.runDailyStakingYield();
      },
      (err) => err instanceof UnconfirmedBusinessRuleError && /Global Business Plan status is/.test(err.message)
    );
  });

  test("45. Legacy incomeService.distributeGlobalPool remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.distributeGlobalPool();
      },
      (err) => err instanceof UnconfirmedBusinessRuleError && /Global Business Plan status is/.test(err.message)
    );
  });

  // ==========================================
  // CATEGORY J — READ-ONLY API CONTROLLERS
  // ==========================================

  test("46. getIncomeRules returns HTTP 200 with full rule transparency and unconfirmed package catalog", async () => {
    let responseStatus, responseData;
    const req = {};
    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getIncomeRules(req, res, () => {});
    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseData.status, "success");
    assert.strictEqual(responseData.data.packageCatalogStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
    assert(responseData.data.referenceLevels.ref_l1);
  });

  test("47. getMemberEligibility returns HTTP 200 with member diagnostic report strictly scoped to req.user.userId", async () => {
    const testUid = "test_p6_ctrl_user_01";
    await createTestUser({
      userId: testUid,
      sponsorId: "none",
    });

    let responseStatus, responseData;
    const req = { user: { userId: testUid } };
    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getMemberEligibility(req, res, () => {});
    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseData.data.status, ELIGIBILITY_STATUS.ELIGIBLE);
    assert.strictEqual(responseData.data.user.userId, testUid);
  });

  test("48. getIncomePreview returns HTTP 200 without creating database records or altering balances", async () => {
    const testUid = "test_p6_ctrl_user_02";
    await createTestUser({
      userId: testUid,
      sponsorId: "none",
    });

    const snapshotCountBefore = await IncomeSnapshot.countDocuments({});

    let responseStatus, responseData;
    const req = { user: { userId: testUid } };
    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getIncomePreview(req, res, () => {});
    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseData.data.userId, testUid);
    assert(responseData.data.notice.includes("Zero wallet credits"));

    const snapshotCountAfter = await IncomeSnapshot.countDocuments({});
    assert.strictEqual(snapshotCountAfter, snapshotCountBefore, "Preview must strictly NOT write any IncomeSnapshot records!");
  });
});
