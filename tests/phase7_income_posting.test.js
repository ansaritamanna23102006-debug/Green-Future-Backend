/**
 * Green Future Tech (GFT) — Phase 7 Test Suite
 * Income Financial Posting Engine & Authoritative Double-Entry Ledger Integration
 * 
 * Categories:
 * Category A: Snapshot Validation
 * Category B: Double-Entry Accounting
 * Category C: Wallet Projection
 * Category D: Idempotency
 * Category E: Concurrency & Race Conditions
 * Category F: Immutability
 * Category G: Security & RBAC
 * Category H: Rule Execution Gating
 * Category I: Legacy Protection
 * Category J: Reconciliation
 * Category K: Failure Safety & Financial Integrity
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

// Models
import User from "../src/models/User.js";
import Wallet from "../src/models/Wallet.js";
import JournalEntry from "../src/models/JournalEntry.js";
import LedgerPosting from "../src/models/LedgerPosting.js";
import IncomeSnapshot from "../src/models/IncomeSnapshot.js";
import AuditLog from "../src/models/AuditLog.js";

// Services and Utilities
import incomePostingService from "../src/services/income/incomePostingService.js";
import ledgerService from "../src/services/ledgerService.js";
import reconciliationService from "../src/services/reconciliationService.js";
import IncomeService from "../src/services/incomeService.js";
import {
  INCOME_TYPES,
  POSTING_STATUS,
  POSTING_AUDIT_ACTIONS,
} from "../src/services/income/incomeConstants.js";
import {
  RULE_STATUS,
  assertRuleExecutable,
} from "../src/utils/rules/businessPlanConfig.js";
import { UnconfirmedBusinessRuleError } from "../src/utils/errors.js";
import {
  JOURNAL_STATUS,
  POSTING_DIRECTION,
  JOURNAL_EVENT_TYPES,
} from "../src/utils/rules/ledgerConstants.js";
import { parseToPaisa, formatPaisaToRupees } from "../src/utils/money.js";
import incomeRoutes from "../src/routes/incomeRoutes.js";
import * as incomeController from "../src/controllers/incomeController.js";
import { ACCOUNT_TYPES } from "../src/utils/rules/ledgerConstants.js";

const TEST_MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gft-db";

let userCounter = 0;
const createTestUser = async (overrides = {}) => {
  userCounter += 1;
  const uid = overrides.userId || `test_p7_u_${Date.now()}_${userCounter}`;
  const doc = {
    userId: uid,
    name: overrides.name || `User ${uid}`,
    email: overrides.email || `${uid}@example.com`,
    mobile: overrides.mobile || `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    password: overrides.password || "Password@123",
    referralCode: overrides.referralCode || `REF_${uid}`,
    sponsorId: overrides.sponsorId !== undefined ? overrides.sponsorId : "none",
    status: overrides.status || "active",
    role: overrides.role || "user",
    kyc: overrides.kyc || { status: "APPROVED" },
    activePackage: overrides.activePackage !== undefined ? overrides.activePackage : { packageId: "pkg_gft_1", status: "ACTIVE" },
    ...overrides,
  };
  return User.create(doc);
};

let snapshotCounter = 0;
const createTestSnapshot = async (overrides = {}) => {
  snapshotCounter += 1;
  const key = overrides.idempotencyKey || `SNAP:test_p7_${Date.now()}_${snapshotCounter}`;
  const doc = {
    beneficiaryUserId: overrides.beneficiaryUserId || `test_p7_ben_${snapshotCounter}`,
    sourceUserId: overrides.sourceUserId || `test_p7_src_${snapshotCounter}`,
    incomeType: overrides.incomeType || INCOME_TYPES.REFERENCE_INCOME,
    level: overrides.level !== undefined ? overrides.level : 1,
    baseAmountPaisa: overrides.baseAmountPaisa !== undefined ? overrides.baseAmountPaisa : 100000,
    rateBasisPoints: overrides.rateBasisPoints !== undefined ? overrides.rateBasisPoints : 500,
    calculatedAmountPaisa: overrides.calculatedAmountPaisa !== undefined ? overrides.calculatedAmountPaisa : 5000,
    idempotencyKey: key,
    ruleVersion: overrides.ruleVersion || "TEST_FIXTURE_CONFIRMED_V1",
    ruleStatus: overrides.ruleStatus || RULE_STATUS.CONFIRMED,
    packageSnapshot: overrides.packageSnapshot !== undefined ? overrides.packageSnapshot : { packageId: "pkg_gft_test" },
    calculationDate: overrides.calculationDate || new Date(),
    calculatedAt: new Date(),
    ...overrides,
  };
  return IncomeSnapshot.create(doc);
};

describe("PHASE 7 — INCOME FINANCIAL POSTING ENGINE", async () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGODB_URI);
    }
    // Clean up Phase 7 test artifacts
    await mongoose.connection.collection("incomesnapshots").deleteMany({ idempotencyKey: /test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("journalentries").deleteMany({ idempotencyKey: /test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ details: /test_p7_/i }).catch(() => {});
  });

  after(async () => {
    await mongoose.connection.collection("incomesnapshots").deleteMany({ idempotencyKey: /test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("journalentries").deleteMany({ idempotencyKey: /test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ userId: /^test_p7_/i }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ details: /test_p7_/i }).catch(() => {});
    await mongoose.disconnect();
  });

  // ==========================================
  // CATEGORY A — SNAPSHOT VALIDATION
  // ==========================================

  test("1. Valid snapshot structure passes validation and posts successfully", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 5000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTED);
    assert.strictEqual(result.isReplay, false);
    assert.strictEqual(result.amountPaisa, 5000);
    assert.strictEqual(result.amountRupees, "50.00");
    assert.ok(result.journalId);
  });

  test("2. Missing snapshot ID / nonexistent snapshot returns POSTING_FAILED", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: fakeId });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "INCOME_SNAPSHOT_NOT_FOUND");
  });

  test("3. Snapshot with missing or empty beneficiaryUserId fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "",
      sourceUserId: "test_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: `KEY_${Date.now()}`,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: 100000,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "INVALID_BENEFICIARY_USER_ID");
  });

  test("4. Snapshot with missing or empty sourceUserId fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "test_ben",
      sourceUserId: "   ",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: `KEY_${Date.now()}`,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: 100000,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "INVALID_SOURCE_USER_ID");
  });

  test("5. Snapshot with unsupported incomeType fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "test_ben",
      sourceUserId: "test_src",
      incomeType: "UNSUPPORTED_TYPE_XYZ",
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: `KEY_${Date.now()}`,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: 100000,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.ok(result.reason.includes("UNSUPPORTED_INCOME_TYPE"));
  });

  test("6. Snapshot with missing ruleVersion fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "test_ben",
      sourceUserId: "test_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      ruleVersion: null,
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: `KEY_${Date.now()}`,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: 100000,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "MISSING_RULE_VERSION");
  });

  test("7. Snapshot with missing idempotencyKey fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "test_ben",
      sourceUserId: "test_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: null,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: 100000,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "MISSING_IDEMPOTENCY_KEY");
  });

  test("8. Snapshot with non-positive calculatedAmountPaisa (0, -100) fails validation", async () => {
    for (const badAmount of [0, -100]) {
      const fakeSnapshot = {
        _id: new mongoose.Types.ObjectId(),
        beneficiaryUserId: "test_ben",
        sourceUserId: "test_src",
        incomeType: INCOME_TYPES.REFERENCE_INCOME,
        ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
        ruleStatus: RULE_STATUS.CONFIRMED,
        idempotencyKey: `KEY_${Date.now()}_${badAmount}`,
        calculatedAmountPaisa: badAmount,
        baseAmountPaisa: 100000,
        calculationDate: new Date(),
      };
      const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
      assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
      assert.ok(result.reason.includes("INVALID_CALCULATED_AMOUNT_PAISA"));
    }
  });

  test("9. Snapshot with floating point or non-safe-integer calculatedAmountPaisa fails validation", async () => {
    for (const badAmount of [123.45, NaN, Infinity]) {
      const fakeSnapshot = {
        _id: new mongoose.Types.ObjectId(),
        beneficiaryUserId: "test_ben",
        sourceUserId: "test_src",
        incomeType: INCOME_TYPES.REFERENCE_INCOME,
        ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
        ruleStatus: RULE_STATUS.CONFIRMED,
        idempotencyKey: `KEY_${Date.now()}_${String(badAmount)}`,
        calculatedAmountPaisa: badAmount,
        baseAmountPaisa: 100000,
        calculationDate: new Date(),
      };
      const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
      assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
      assert.ok(result.reason.includes("INVALID_CALCULATED_AMOUNT_PAISA"));
    }
  });

  test("10. Snapshot with negative baseAmountPaisa fails validation", async () => {
    const fakeSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryUserId: "test_ben",
      sourceUserId: "test_src",
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      idempotencyKey: `KEY_${Date.now()}_neg_base`,
      calculatedAmountPaisa: 5000,
      baseAmountPaisa: -100,
      calculationDate: new Date(),
    };
    const result = await incomePostingService.postIncomeSnapshot({ snapshot: fakeSnapshot });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.ok(result.reason.includes("INVALID_BASE_AMOUNT_PAISA"));
  });

  // ==========================================
  // CATEGORY B — DOUBLE ENTRY ACCOUNTING
  // ==========================================

  test("11. Valid posting creates JournalEntry with eventType COMMISSION_CREDIT", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 7500,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTED);

    const journal = await JournalEntry.findById(result.journalId);
    assert.ok(journal);
    assert.strictEqual(journal.eventType, JOURNAL_EVENT_TYPES.COMMISSION_CREDIT);
    assert.strictEqual(journal.status, JOURNAL_STATUS.COMMITTED);
    assert.strictEqual(journal.referenceId, String(snapshot._id));
  });

  test("12. Balanced entry invariant: Sum(Debits) === Sum(Credits)", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 12000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const postings = await LedgerPosting.find({ journalId: result.journalId });

    assert.strictEqual(postings.length, 2);
    let totalDebits = 0;
    let totalCredits = 0;
    for (const p of postings) {
      if (p.direction === POSTING_DIRECTION.DEBIT) totalDebits += p.amountPaisa;
      if (p.direction === POSTING_DIRECTION.CREDIT) totalCredits += p.amountPaisa;
    }
    assert.strictEqual(totalDebits, 12000);
    assert.strictEqual(totalCredits, 12000);
    assert.strictEqual(totalDebits, totalCredits);
  });

  test("13. Debit posting targets SYSTEM:RESERVE account with POSTING_DIRECTION.DEBIT", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 8000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const debitPosting = await LedgerPosting.findOne({
      journalId: result.journalId,
      direction: POSTING_DIRECTION.DEBIT,
    });

    assert.ok(debitPosting);
    assert.strictEqual(debitPosting.accountId, "SYSTEM:RESERVE");
    assert.strictEqual(debitPosting.walletType, "SYSTEM_RESERVE");
    assert.strictEqual(debitPosting.amountPaisa, 8000);
  });

  test("14. Credit posting targets USER:{userId}:AVAILABLE_INCOME account with POSTING_DIRECTION.CREDIT", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 8000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const creditPosting = await LedgerPosting.findOne({
      journalId: result.journalId,
      direction: POSTING_DIRECTION.CREDIT,
    });

    assert.ok(creditPosting);
    assert.strictEqual(creditPosting.accountId, `USER:${user.userId}:AVAILABLE_INCOME`);
    assert.strictEqual(creditPosting.userId, user.userId);
    assert.strictEqual(creditPosting.walletType, "AVAILABLE_INCOME");
    assert.strictEqual(creditPosting.amountPaisa, 8000);
  });

  test("15. Unbalanced double entry is rejected before write (no one-sided posting)", async () => {
    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: `IMBALANCED_${Date.now()}`,
          referenceId: `REF_IMBALANCED_${Date.now()}`,
          eventType: JOURNAL_EVENT_TYPES.COMMISSION_CREDIT,
          description: "Unbalanced test posting",
          postings: [
            {
              accountId: "SYSTEM:RESERVE",
              currency: "INR",
              amountPaisa: 5000,
              direction: POSTING_DIRECTION.DEBIT,
            },
            {
              accountId: "USER:u1:AVAILABLE_INCOME",
              currency: "INR",
              amountPaisa: 4000, // Imbalanced!
              direction: POSTING_DIRECTION.CREDIT,
            },
          ],
        });
      },
      { message: /Unbalanced double-entry journal/ }
    );
  });

  test("16. Posting amounts in debits and credits match calculatedAmountPaisa exactly", async () => {
    const user = await createTestUser();
    const exactAmount = 14352;
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: exactAmount,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const postings = await LedgerPosting.find({ journalId: result.journalId });

    for (const p of postings) {
      assert.strictEqual(p.amountPaisa, exactAmount);
    }
  });

  // ==========================================
  // CATEGORY C — WALLET PROJECTION
  // ==========================================

  test("17. Wallet availablePaisa is incremented by exactly calculatedAmountPaisa", async () => {
    const user = await createTestUser();
    await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 10000,
      lockedPaisa: 0,
      totalEarnedPaisa: 10000,
      version: 1,
    });

    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 3500,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 13500);
  });

  test("18. Wallet totalEarnedPaisa is incremented by exactly calculatedAmountPaisa", async () => {
    const user = await createTestUser();
    await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 20000,
      version: 1,
    });

    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 4500,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.totalEarnedPaisa, 24500);
  });

  test("19. Wallet lockedPaisa is strictly untouched (remains 0 or unchanged)", async () => {
    const user = await createTestUser();
    await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 5000,
      lockedPaisa: 50000, // e.g. locked staking
      totalEarnedPaisa: 5000,
      version: 1,
    });

    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 2000,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.lockedPaisa, 50000); // Strictly unchanged
  });

  test("20. Direct wallet mutation outside ledgerService is prohibited in business workflow", async () => {
    const user = await createTestUser();
    const initialWallet = await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    // Verification that reconcile detects any arbitrary non-ledger mutation
    await Wallet.updateOne({ userId: user.userId }, { $inc: { availablePaisa: 9999 } });
    const recon = await reconciliationService.reconcileUser(user.userId);
    assert.strictEqual(recon.status, "DISCREPANCY_DETECTED");
    assert.strictEqual(recon.discrepancyPaisa, 9999);
  });

  test("21. Multiple consecutive postings for different snapshots accumulate wallet projection accurately", async () => {
    const user = await createTestUser();
    const snap1 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 1000 });
    const snap2 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 2500 });
    const snap3 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 4000 });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snap1._id });
    await incomePostingService.postIncomeSnapshot({ snapshotId: snap2._id });
    await incomePostingService.postIncomeSnapshot({ snapshotId: snap3._id });

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 7500);
    assert.strictEqual(wallet.totalEarnedPaisa, 7500);
  });

  test("22. Wallet initialized on the fly for new user during posting with zero initial balances", async () => {
    const user = await createTestUser();
    // User has no Wallet document yet
    const preWallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(preWallet, null);

    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 3000,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const postWallet = await Wallet.findOne({ userId: user.userId });
    assert.ok(postWallet);
    assert.strictEqual(postWallet.availablePaisa, 3000);
    assert.strictEqual(postWallet.totalEarnedPaisa, 3000);
    assert.strictEqual(postWallet.lockedPaisa, 0);
  });

  // ==========================================
  // CATEGORY D — IDEMPOTENCY
  // ==========================================

  test("23. Replaying the exact same snapshot returns ALREADY_POSTED with isReplay: true", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 6000,
    });

    const firstRun = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(firstRun.postingStatus, POSTING_STATUS.POSTED);

    const secondRun = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(secondRun.postingStatus, POSTING_STATUS.ALREADY_POSTED);
    assert.strictEqual(secondRun.isReplay, true);
    assert.strictEqual(String(secondRun.journalId), String(firstRun.journalId));
  });

  test("24. Replaying the same snapshot does NOT create duplicate JournalEntry records", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const journals = await JournalEntry.find({ referenceId: String(snapshot._id) });
    assert.strictEqual(journals.length, 1);
  });

  test("25. Replaying the same snapshot does NOT create duplicate LedgerPosting records", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const postings = await LedgerPosting.find({ userId: user.userId });
    assert.strictEqual(postings.length, 1); // 1 credit posting for this user
  });

  test("26. Replaying the same snapshot does NOT credit wallet a second time (balance unchanged)", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const walletAfterFirst = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(walletAfterFirst.availablePaisa, 5000);

    // Replay
    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const walletAfterSecond = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(walletAfterSecond.availablePaisa, 5000); // Strictly unchanged
  });

  test("27. Conflicting idempotency key for same snapshot referenceId is rejected with 409 Conflict", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    // Attempt to manually post with a different idempotencyKey for the same snapshot referenceId
    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: `CONFLICTING_KEY_${Date.now()}`,
          referenceId: String(snapshot._id),
          eventType: JOURNAL_EVENT_TYPES.COMMISSION_CREDIT,
          description: "Conflicting attempt",
          postings: [
            { accountId: "SYSTEM:RESERVE", currency: "INR", amountPaisa: 5000, direction: POSTING_DIRECTION.DEBIT },
            { accountId: `USER:${user.userId}:AVAILABLE_INCOME`, userId: user.userId, currency: "INR", amountPaisa: 5000, direction: POSTING_DIRECTION.CREDIT },
          ],
        });
      },
      { statusCode: 409 }
    );
  });

  test("28. Different snapshots for the same beneficiary post independently and credit accurately", async () => {
    const user = await createTestUser();
    const snapA = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 2000 });
    const snapB = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 3000 });

    const resA = await incomePostingService.postIncomeSnapshot({ snapshotId: snapA._id });
    const resB = await incomePostingService.postIncomeSnapshot({ snapshotId: snapB._id });

    assert.strictEqual(resA.postingStatus, POSTING_STATUS.POSTED);
    assert.strictEqual(resB.postingStatus, POSTING_STATUS.POSTED);
    assert.notStrictEqual(String(resA.journalId), String(resB.journalId));

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 5000);
  });

  // ==========================================
  // CATEGORY E — CONCURRENCY & RACE CONDITIONS
  // ==========================================

  test("29. Two simultaneous workers attempting to post the same snapshot result in exactly ONE successful financial write", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 10000 });

    const [w1, w2] = await Promise.all([
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "WORKER_A" }),
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "WORKER_B" }),
    ]);

    const statuses = [w1.postingStatus, w2.postingStatus];
    assert.ok(statuses.includes(POSTING_STATUS.POSTED));
    assert.ok(
      statuses.includes(POSTING_STATUS.ALREADY_POSTED) ||
      (w1.postingStatus === POSTING_STATUS.POSTED && w2.isReplay === true)
    );

    const journals = await JournalEntry.find({ referenceId: String(snapshot._id) });
    assert.strictEqual(journals.length, 1);

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 10000);
    assert.strictEqual(wallet.totalEarnedPaisa, 10000);
  });

  test("30. Concurrent posting attempts preserve wallet balance without duplicate crediting", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 7000 });

    await Promise.all([
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id }),
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id }),
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id }),
    ]);

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 7000);
    assert.strictEqual(wallet.totalEarnedPaisa, 7000);
  });

  test("31. Concurrent posting attempts produce exactly one logical JournalEntry", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });

    await Promise.all([
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id }),
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id }),
    ]);

    const journals = await JournalEntry.find({ referenceId: String(snapshot._id) });
    assert.strictEqual(journals.length, 1);
  });

  test("32. Parallel posting of distinct snapshots for the same user concurrently resolves with exact cumulative balance", async () => {
    const user = await createTestUser();
    const s1 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 1000 });
    const s2 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 2000 });
    const s3 = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 3000 });

    await Promise.all([
      incomePostingService.postIncomeSnapshot({ snapshotId: s1._id }),
      incomePostingService.postIncomeSnapshot({ snapshotId: s2._id }),
      incomePostingService.postIncomeSnapshot({ snapshotId: s3._id }),
    ]);

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 6000);
    assert.strictEqual(wallet.totalEarnedPaisa, 6000);
  });

  // ==========================================
  // CATEGORY F — IMMUTABILITY
  // ==========================================

  test("33. Direct update on JournalEntry core fields is blocked by immutability guard", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });
    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    await assert.rejects(
      async () => {
        await JournalEntry.updateOne(
          { _id: result.journalId },
          { $set: { eventType: JOURNAL_EVENT_TYPES.ORDER_PAYMENT } }
        );
      },
      { message: /Fatal: Core financial identifiers on JournalEntry are immutable/ }
    );
  });

  test("34. Direct deletion of JournalEntry is permanently blocked", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });
    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    await assert.rejects(
      async () => {
        await JournalEntry.deleteOne({ _id: result.journalId });
      },
      { message: /immutable and cannot be deleted/ }
    );
  });

  test("35. Direct deletion of LedgerPosting is permanently blocked", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: user.userId, calculatedAmountPaisa: 5000 });
    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    await assert.rejects(
      async () => {
        await LedgerPosting.deleteOne({ journalId: result.journalId });
      },
      { message: /immutable and cannot be deleted/ }
    );
  });

  test("36. Direct update of IncomeSnapshot is permanently blocked", async () => {
    const snapshot = await createTestSnapshot({ calculatedAmountPaisa: 5000 });

    await assert.rejects(
      async () => {
        await IncomeSnapshot.updateOne({ _id: snapshot._id }, { $set: { calculatedAmountPaisa: 99999 } });
      },
      { message: /IncomeSnapshot records are permanently immutable and cannot be updated/ }
    );
  });

  test("37. Direct deletion of IncomeSnapshot is permanently blocked", async () => {
    const snapshot = await createTestSnapshot({ calculatedAmountPaisa: 5000 });

    await assert.rejects(
      async () => {
        await IncomeSnapshot.deleteOne({ _id: snapshot._id });
      },
      { message: /IncomeSnapshot records are permanently immutable and cannot be deleted/ }
    );
  });

  // ==========================================
  // CATEGORY G — SECURITY & RBAC: DIRECT ADMIN POSTING REMOVAL
  // ==========================================

  const generateTestToken = (user) => {
    return jwt.sign(
      { id: user._id, userId: user.userId, role: user.role },
      process.env.JWT_SECRET || "default-secret-key-123",
      { expiresIn: "1h" }
    );
  };

  const dispatchIncomeRoute = (req) => {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headersSent: false,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; resolve({ status: this.statusCode, body: this.body }); return this; },
      };
      incomeRoutes(req, res, (err) => {
        if (err) {
          return resolve({ status: err.statusCode || 500, error: err });
        }
        return resolve({ status: 404, message: `Cannot ${req.method} ${req.url}` });
      });
    });
  };

  test("38. TEST A: Normal member/user attempting old admin posting endpoint receives 404", async () => {
    const memberUser = await createTestUser({ role: "user" });
    const token = generateTestToken(memberUser);
    const snapshot = await createTestSnapshot({ beneficiaryUserId: memberUser.userId });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id) },
    };

    const response = await dispatchIncomeRoute(req);
    assert.strictEqual(response.status, 404);
  });

  test("39. Unauthenticated request to old admin posting endpoint is rejected with 401", async () => {
    const snapshot = await createTestSnapshot();
    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: {},
      body: { snapshotId: String(snapshot._id) },
    };

    const response = await dispatchIncomeRoute(req);
    assert.strictEqual(response.status, 401);
  });

  test("40. TEST B: Admin attempting to directly invoke old financial posting HTTP endpoint cannot cause financial posting (receives 404)", async () => {
    const adminUser = await createTestUser({ role: "admin" });
    const token = generateTestToken(adminUser);
    const memberUser = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: memberUser.userId, calculatedAmountPaisa: 5000 });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id) },
    };

    const response = await dispatchIncomeRoute(req);
    assert.strictEqual(response.status, 404);
  });

  test("41. TEST C: Super Admin attempting to directly invoke old financial posting HTTP endpoint cannot cause financial posting (receives 404)", async () => {
    const superAdmin = await createTestUser({ role: "superadmin" });
    const token = generateTestToken(superAdmin);
    const memberUser = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: memberUser.userId, calculatedAmountPaisa: 6000 });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id) },
    };

    const response = await dispatchIncomeRoute(req);
    assert.strictEqual(response.status, 404);
  });

  test("42. TEST D: No alternate HTTP endpoint exists in incomeController or incomeRoutes for direct financial posting", async () => {
    assert.strictEqual(incomeController.adminPostIncomeSnapshot, undefined);

    const postRoutes = incomeRoutes.stack
      .filter((layer) => layer.route)
      .filter((layer) => layer.route.methods && layer.route.methods.post);
    assert.strictEqual(postRoutes.length, 0, "incomeRoutes must not contain any POST routes");

    const getRoutePaths = incomeRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);
    assert.deepStrictEqual(getRoutePaths.sort(), ["/eligibility", "/preview", "/rules"]);
  });

  test("43. TEST I: No wallet balance changes occur when an unauthorized HTTP attempt is made", async () => {
    const adminUser = await createTestUser({ role: "admin" });
    const token = generateTestToken(adminUser);
    const memberUser = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: memberUser.userId, calculatedAmountPaisa: 5000 });

    await Wallet.create({
      user: memberUser._id,
      userId: memberUser.userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id), amount: 999999 },
    };

    await dispatchIncomeRoute(req);

    const wallet = await Wallet.findOne({ userId: memberUser.userId });
    assert.strictEqual(wallet.availablePaisa, 0, "availablePaisa must remain strictly 0");
    assert.strictEqual(wallet.totalEarnedPaisa, 0, "totalEarnedPaisa must remain strictly 0");
  });

  test("44. TEST J: No JournalEntry or LedgerPosting is created when an unauthorized HTTP attempt is made", async () => {
    const adminUser = await createTestUser({ role: "admin" });
    const token = generateTestToken(adminUser);
    const memberUser = await createTestUser();
    const snapshot = await createTestSnapshot({ beneficiaryUserId: memberUser.userId, calculatedAmountPaisa: 7500 });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id) },
    };

    await dispatchIncomeRoute(req);

    const journalCount = await JournalEntry.countDocuments({ referenceId: String(snapshot._id) });
    assert.strictEqual(journalCount, 0, "Zero JournalEntry records must be created");

    const postingCount = await LedgerPosting.countDocuments({ userId: memberUser.userId });
    assert.strictEqual(postingCount, 0, "Zero LedgerPosting records must be created");
  });

  test("44b. TEST K: No IncomeSnapshot is modified by an unauthorized HTTP attempt", async () => {
    const adminUser = await createTestUser({ role: "admin" });
    const token = generateTestToken(adminUser);
    const memberUser = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: memberUser.userId,
      calculatedAmountPaisa: 5000,
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    const req = {
      method: "POST",
      url: "/admin/post-snapshot",
      headers: { authorization: `Bearer ${token}` },
      body: { snapshotId: String(snapshot._id), calculatedAmountPaisa: 9999999 },
    };

    await dispatchIncomeRoute(req);

    const freshSnapshot = await IncomeSnapshot.findById(snapshot._id);
    assert.strictEqual(freshSnapshot.calculatedAmountPaisa, 5000);
    assert.strictEqual(freshSnapshot.ruleStatus, RULE_STATUS.CONFIRMED);
    assert.strictEqual(freshSnapshot.beneficiaryUserId, memberUser.userId);
  });

  test("44c. TEST E & F: Calling incomePostingService.postIncomeSnapshot() internally still works for valid CONFIRMED fixture and route removal does not break internal posting", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 4500,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTED);
    assert.strictEqual(result.isReplay, false);
    assert.strictEqual(result.amountPaisa, 4500);

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 4500);
  });

  test("44d. TEST G: A blocked/unconfirmed production snapshot remains POSTING_BLOCKED when invoked internally", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      packageSnapshot: { packageId: "pkg_gft_1" },
      calculatedAmountPaisa: 3000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
  });

  test("44e. TEST H: Admin/Super Admin cannot bypass the rule execution gate even via internal posting", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 4,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      calculatedAmountPaisa: 1500,
    });

    const result = await incomePostingService.postIncomeSnapshot({
      snapshotId: snapshot._id,
      adminUserId: "SUPERADMIN_OVERRIDE",
    });

    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet, null, "Zero wallet crediting when rule is unconfirmed");
  });

  test("44f. TEST L: Idempotency behavior remains unchanged for legitimate internal posting", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 8000,
    });

    const run1 = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    const run2 = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    assert.strictEqual(run1.postingStatus, POSTING_STATUS.POSTED);
    assert.strictEqual(run2.postingStatus, POSTING_STATUS.ALREADY_POSTED);
    assert.strictEqual(run2.isReplay, true);
    assert.strictEqual(String(run1.journalId), String(run2.journalId));

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 8000);
  });

  test("44g. TEST M: Concurrent internal posting remains exactly-once", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 9000,
    });

    const [w1, w2] = await Promise.all([
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "WORKER_1" }),
      incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "WORKER_2" }),
    ]);

    const statuses = [w1.postingStatus, w2.postingStatus];
    assert.ok(statuses.includes(POSTING_STATUS.POSTED));
    assert.ok(statuses.includes(POSTING_STATUS.ALREADY_POSTED) || w2.isReplay === true);

    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.availablePaisa, 9000);
  });

  test("44h. SYSTEM:RESERVE account mapping is verified against Phase 4 ledger constants", () => {
    assert.ok(ACCOUNT_TYPES.SYSTEM_RESERVE, "ACCOUNT_TYPES.SYSTEM_RESERVE must be defined in Phase 4");
    assert.strictEqual(ACCOUNT_TYPES.SYSTEM_RESERVE, "SYSTEM_RESERVE");
  });

  // ==========================================
  // CATEGORY H — RULE EXECUTION GATING
  // ==========================================

  test("45. Confirmed test-fixture rule posts successfully when ruleStatus is CONFIRMED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      ruleVersion: "TEST_FIXTURE_CONFIRMED_V1",
      ruleStatus: RULE_STATUS.CONFIRMED,
      calculatedAmountPaisa: 5000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTED);
  });

  test("46. Unconfirmed package dependency (e.g. pkg_gft_1) blocks financial posting with POSTING_BLOCKED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 1,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      packageSnapshot: { packageId: "pkg_gft_1" }, // Unconfirmed package
      calculatedAmountPaisa: 5000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
    assert.ok(result.reason.includes("Global Business Plan status is 'REQUIRES_CLIENT_CONFIRMATION'") || result.reason.includes("pkg_gft_1"));
  });

  test("47. Reference Level 4 (REQUIRES_CLIENT_CONFIRMATION) is blocked from posting with POSTING_BLOCKED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 4,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      calculatedAmountPaisa: 1500,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
  });

  test("48. Reference Level 5 (REQUIRES_CLIENT_CONFIRMATION) is blocked from posting with POSTING_BLOCKED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.REFERENCE_INCOME,
      level: 5,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      calculatedAmountPaisa: 1000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
  });

  test("49. Passive Tier 8 (arithmetic mismatch) is blocked from posting with POSTING_BLOCKED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      incomeType: INCOME_TYPES.PASSIVE_TURNOVER,
      tier: 8,
      ruleVersion: "BUSINESS_PLAN_DRAFT_V0",
      ruleStatus: RULE_STATUS.CONFIRMED,
      calculatedAmountPaisa: 1200000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
    assert.ok(result.reason.includes("Tier 8") || result.reason.includes("Global Business Plan status"));
  });

  test("50. Snapshot with ruleStatus !== CONFIRMED (e.g. REQUIRES_CLIENT_CONFIRMATION) is blocked with POSTING_BLOCKED", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      ruleStatus: RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
      calculatedAmountPaisa: 5000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
    assert.ok(result.reason.includes("REQUIRES_CLIENT_CONFIRMATION"));
  });

  test("51. Disabled rule is blocked from financial posting", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      ruleStatus: RULE_STATUS.DISABLED,
      calculatedAmountPaisa: 5000,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_BLOCKED);
    assert.ok(result.reason.includes("DISABLED"));
  });

  // ==========================================
  // CATEGORY I — LEGACY ENGINE LOCKDOWN
  // ==========================================

  test("52. Legacy incomeService.payDirectIncome remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.payDirectIncome("test_u1", 3000);
      },
      (err) => {
        assert.ok(err instanceof UnconfirmedBusinessRuleError);
        return true;
      }
    );
  });

  test("53. Legacy incomeService.runWeeklyBinaryMatching remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.runWeeklyBinaryMatching();
      },
      (err) => {
        assert.ok(err instanceof UnconfirmedBusinessRuleError);
        return true;
      }
    );
  });

  test("54. Legacy incomeService.runDailyStakingYield remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.runDailyStakingYield();
      },
      (err) => {
        assert.ok(err instanceof UnconfirmedBusinessRuleError);
        return true;
      }
    );
  });

  test("55. Legacy incomeService.distributeGlobalPool remains gated under Phase 0 assertRuleExecutable", async () => {
    await assert.rejects(
      async () => {
        await IncomeService.distributeGlobalPool();
      },
      (err) => {
        assert.ok(err instanceof UnconfirmedBusinessRuleError);
        return true;
      }
    );
  });

  // ==========================================
  // CATEGORY J — RECONCILIATION
  // ==========================================

  test("56. Correct posting reconciles to status BALANCED with zero discrepancy", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 5000,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    const recon = await reconciliationService.reconcileUser(user.userId);
    assert.strictEqual(recon.status, "BALANCED");
    assert.strictEqual(recon.discrepancyPaisa, 0);
    assert.strictEqual(recon.calculatedLedgerSumPaisa, 5000);
    assert.strictEqual(recon.walletProjectionPaisa, 5000);
  });

  test("57. Reconcile detects discrepancy between Wallet projection and LedgerPostings without silent repair", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 5000,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });

    // Intentionally corrupt projection to test discrepancy detection
    await Wallet.updateOne({ userId: user.userId }, { $set: { availablePaisa: 99999 } });

    const recon = await reconciliationService.reconcileUser(user.userId);
    assert.strictEqual(recon.status, "DISCREPANCY_DETECTED");
    assert.strictEqual(recon.discrepancyPaisa, 94999);

    // Verify wallet was NOT silently changed back
    const walletAfterRecon = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(walletAfterRecon.availablePaisa, 99999);
  });

  test("58. Reconciliation mismatch sets reconciliationMismatch flag on Wallet document", async () => {
    const user = await createTestUser();
    await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 12345,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    await reconciliationService.reconcileUser(user.userId);
    const wallet = await Wallet.findOne({ userId: user.userId });
    assert.strictEqual(wallet.reconciliationMismatch, true);
  });

  // ==========================================
  // CATEGORY K — FAILURE SAFETY & FINANCIAL INTEGRITY
  // ==========================================

  test("59. Missing snapshot document produces POSTING_FAILED with clear reason", async () => {
    const missingId = new mongoose.Types.ObjectId();
    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: missingId });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTING_FAILED);
    assert.strictEqual(result.reason, "INCOME_SNAPSHOT_NOT_FOUND");
  });

  test("60. Invalid ledger posting currency or invalid direction is safely rejected", async () => {
    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: `INV_CURR_${Date.now()}`,
          referenceId: `REF_INV_CURR_${Date.now()}`,
          eventType: JOURNAL_EVENT_TYPES.COMMISSION_CREDIT,
          description: "Invalid currency test",
          postings: [
            { accountId: "SYSTEM:RESERVE", currency: "DOGECOIN", amountPaisa: 1000, direction: POSTING_DIRECTION.DEBIT },
            { accountId: "USER:u1:AVAILABLE_INCOME", currency: "DOGECOIN", amountPaisa: 1000, direction: POSTING_DIRECTION.CREDIT },
          ],
        });
      },
      { message: /Unsupported ledger currency/ }
    );
  });

  test("61. Post result returns deterministic JSON structure with integer Paisa and formatted INR", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 25050,
    });

    const result = await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id });
    assert.strictEqual(result.postingStatus, POSTING_STATUS.POSTED);
    assert.strictEqual(result.amountPaisa, 25050);
    assert.strictEqual(result.amountRupees, "250.50");
    assert.ok(result.journalId);
    assert.ok(result.idempotencyKey);
    assert.ok(result.timestamp);
  });

  test("62. Full End-to-End audit trail verifies all financial transitions", async () => {
    const user = await createTestUser();
    const snapshot = await createTestSnapshot({
      beneficiaryUserId: user.userId,
      calculatedAmountPaisa: 5000,
    });

    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "AUDIT_ADMIN" });

    // Replay to test DUPLICATE audit
    await incomePostingService.postIncomeSnapshot({ snapshotId: snapshot._id, adminUserId: "AUDIT_ADMIN" });

    const auditLogs = await AuditLog.find({
      $or: [
        { action: POSTING_AUDIT_ACTIONS.INCOME_POSTING_STARTED },
        { action: POSTING_AUDIT_ACTIONS.INCOME_POSTING_COMPLETED },
        { action: POSTING_AUDIT_ACTIONS.INCOME_POSTING_DUPLICATE },
      ],
    });

    const actions = auditLogs.map((l) => l.action);
    assert.ok(actions.includes(POSTING_AUDIT_ACTIONS.INCOME_POSTING_STARTED));
    assert.ok(actions.includes(POSTING_AUDIT_ACTIONS.INCOME_POSTING_COMPLETED));
    assert.ok(actions.includes(POSTING_AUDIT_ACTIONS.INCOME_POSTING_DUPLICATE));
  });
});
