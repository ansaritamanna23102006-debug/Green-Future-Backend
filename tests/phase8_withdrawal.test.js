import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import Wallet from "../src/models/Wallet.js";
import Withdrawal from "../src/models/Withdrawal.js";
import JournalEntry from "../src/models/JournalEntry.js";
import LedgerPosting from "../src/models/LedgerPosting.js";
import AuditLog from "../src/models/AuditLog.js";
import withdrawalService from "../src/services/withdrawal/withdrawalService.js";
import ledgerService from "../src/services/ledgerService.js";
import reconciliationService from "../src/services/reconciliationService.js";
import { SandboxPayoutAdapter } from "../src/services/withdrawal/payoutProvider.js";
import {
  WITHDRAWAL_STATUS,
  DESTINATION_TYPES,
  WITHDRAWAL_AUDIT_ACTIONS,
} from "../src/services/withdrawal/withdrawalConstants.js";
import {
  ACCOUNT_TYPES,
  POSTING_DIRECTION,
  JOURNAL_EVENT_TYPES,
  JOURNAL_STATUS,
} from "../src/utils/rules/ledgerConstants.js";
import { RULE_STATUS } from "../src/utils/rules/businessPlanConfig.js";

import dotenv from "dotenv";

dotenv.config();

const TEST_MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gft-db";

describe("Phase 8: Safe Withdrawal & Payout Engine Test Suite", () => {
  const confirmedTestRule = {
    isExecutable: true,
    minWithdrawalINR: 500, // min 50,000 paisa
    processingFeePercentage: 5.0,
    ruleVersion: "TEST_CONFIRMED_V1",
    reason: null,
  };

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGODB_URI);
    }
  });

  after(async () => {
    await mongoose.connection.collection("withdrawals").deleteMany({ idempotencyKey: /^IDEMP:/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("journalentries").deleteMany({ idempotencyKey: /^(LEDGER:WITHDRAWAL|INITIAL_DEPOSIT|LEDGER:INIT)/i }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await mongoose.connection.collection("withdrawals").deleteMany({ idempotencyKey: /^IDEMP:/i }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("journalentries").deleteMany({ idempotencyKey: /^(LEDGER:WITHDRAWAL|INITIAL_DEPOSIT|LEDGER:INIT)/i }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ userId: /^USR_/i }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ userId: /^USR_/i }).catch(() => {});
  });

  // Helper to create test user with funded wallet via authoritative ledger deposit
  async function createTestUser({
    userId = "USR_TEST_01",
    role = "user",
    kycStatus = "APPROVED",
    initialAvailablePaisa = 100000, // ₹1,000
  } = {}) {
    const user = await User.create({
      userId,
      name: "Test User",
      email: `${userId.toLowerCase()}@test.com`,
      mobile: "9876543210",
      password: "hashed_password",
      role,
      sponsorId: "none",
      referralCode: `REF_${userId}`,
      kyc: {
        status: kycStatus,
      },
    });

    if (initialAvailablePaisa > 0) {
      await ledgerService.recordJournalEntry({
        referenceId: `INITIAL_DEPOSIT:${userId}`,
        eventType: JOURNAL_EVENT_TYPES.MANUAL_DEPOSIT,
        idempotencyKey: `LEDGER:INIT:${userId}`,
        description: `Initial funding for test user ${userId}`,
        postings: [
          {
            accountId: "SYSTEM:CLEARING",
            userId: "",
            walletType: ACCOUNT_TYPES.SYSTEM_CLEARING,
            currency: "INR",
            amountPaisa: initialAvailablePaisa,
            direction: POSTING_DIRECTION.DEBIT,
          },
          {
            accountId: `USER:${userId}:AVAILABLE_INCOME`,
            userId,
            walletType: "AVAILABLE_INCOME",
            currency: "INR",
            amountPaisa: initialAvailablePaisa,
            direction: POSTING_DIRECTION.CREDIT,
          },
        ],
        metadata: { userId },
      });
    }

    return user;
  }

  // =========================================================================
  // CATEGORY A — MODEL VALIDATION & IMMUTABILITY
  // =========================================================================
  describe("Category A: Withdrawal Model & Minor-Unit Validation", () => {
    it("A1: Should reject negative withdrawal amount", async () => {
      await createTestUser({ userId: "USR_A1" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_A1",
            amountPaisa: -50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:9988776655",
            idempotencyKey: "IDEMP:A1:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /positive integer in Paisa/i
      );
    });

    it("A2: Should reject zero withdrawal amount", async () => {
      await createTestUser({ userId: "USR_A2" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_A2",
            amountPaisa: 0,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:9988776655",
            idempotencyKey: "IDEMP:A2:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /positive integer in Paisa/i
      );
    });

    it("A3: Should reject floating-point / unsafe integer amounts", async () => {
      await createTestUser({ userId: "USR_A3" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_A3",
            amountPaisa: 50000.75,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:9988776655",
            idempotencyKey: "IDEMP:A3:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /positive integer in Paisa/i
      );
    });

    it("A4: Should reject invalid destinationType", async () => {
      await createTestUser({ userId: "USR_A4" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_A4",
            amountPaisa: 50000,
            destinationType: "INVALID_CRYPTO_TOKEN",
            destinationReference: "0x12345",
            idempotencyKey: "IDEMP:A4:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Invalid destinationType/i
      );
    });

    it("A5: Should reject missing destinationReference", async () => {
      await createTestUser({ userId: "USR_A5" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_A5",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.USDT_TRC20,
            destinationReference: "   ",
            idempotencyKey: "IDEMP:A5:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /destinationReference is required/i
      );
    });

    it("A6: Withdrawal schema pre-hooks must block direct document deletion", async () => {
      await createTestUser({ userId: "USR_A6" });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_A6",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:9988776655",
        idempotencyKey: "IDEMP:A6:1",
        testRuleOverride: confirmedTestRule,
      });

      await assert.rejects(
        async () => {
          await Withdrawal.deleteOne({ _id: withdrawal._id });
        },
        /immutable and cannot be deleted/i
      );

      await assert.rejects(
        async () => {
          await Withdrawal.deleteMany({});
        },
        /immutable and cannot be deleted/i
      );
    });
  });

  // =========================================================================
  // CATEGORY B — KYC SERVICE-LEVEL GATE
  // =========================================================================
  describe("Category B: KYC Verification Gate (Service-Level & Middleware)", () => {
    it("B1: Direct withdrawalService call with kyc.status !== APPROVED must be BLOCKED with zero financial side-effects", async () => {
      await createTestUser({ userId: "USR_B1", kycStatus: "SUBMITTED", initialAvailablePaisa: 100000 });
      const initialWallet = await Wallet.findOne({ userId: "USR_B1" });
      const initialJournalsCount = await JournalEntry.countDocuments({});
      const initialPostingsCount = await LedgerPosting.countDocuments({});

      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_B1",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:B1:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Withdrawal blocked: KYC verification required.*SUBMITTED/i
      );

      // Verify ZERO financial mutation
      const finalWallet = await Wallet.findOne({ userId: "USR_B1" });
      assert.strictEqual(finalWallet.availablePaisa, initialWallet.availablePaisa);
      assert.strictEqual(finalWallet.lockedPaisa, initialWallet.lockedPaisa);

      // Verify ZERO new journals or postings created
      const finalJournalsCount = await JournalEntry.countDocuments({});
      const finalPostingsCount = await LedgerPosting.countDocuments({});
      assert.strictEqual(finalJournalsCount, initialJournalsCount);
      assert.strictEqual(finalPostingsCount, initialPostingsCount);

      // Verify audit event recorded
      const audit = await AuditLog.findOne({
        userId: "USR_B1",
        action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_BLOCKED,
      });
      assert.ok(audit, "Audit log must record WITHDRAWAL_BLOCKED for unapproved KYC");
    });

    it("B2: Withdrawal blocked when kyc.status is REJECTED", async () => {
      await createTestUser({ userId: "USR_B2", kycStatus: "REJECTED" });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_B2",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:B2:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Withdrawal blocked: KYC verification required.*REJECTED/i
      );
    });

    it("B3: Withdrawal blocked when user has no KYC subdocument (NOT_STARTED)", async () => {
      const user = await User.create({
        userId: "USR_B3",
        name: "No KYC User",
        email: "nokyc@test.com",
        mobile: "9876543211",
        password: "hashed_password",
        role: "user",
        sponsorId: "none",
        referralCode: "REF_NOKYC",
      });

      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_B3",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:B3:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Withdrawal blocked: KYC verification required.*NOT_STARTED/i
      );
    });

    it("B4: Withdrawal allowed when kyc.status === 'APPROVED'", async () => {
      await createTestUser({ userId: "USR_B4", kycStatus: "APPROVED", initialAvailablePaisa: 100000 });
      const result = await withdrawalService.requestWithdrawal({
        userId: "USR_B4",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:B4:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(result.isReplay, false);
      assert.strictEqual(result.withdrawal.status, WITHDRAWAL_STATUS.REQUESTED);
    });
  });

  // =========================================================================
  // CATEGORY C — BALANCE VALIDATION & ATOMIC RESERVATION
  // =========================================================================
  describe("Category C: Balance Checks & Double-Entry Reservation", () => {
    it("C1: Should reject withdrawal when requested amount exceeds available balance", async () => {
      await createTestUser({ userId: "USR_C1", initialAvailablePaisa: 50000 }); // ₹500 available
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_C1",
            amountPaisa: 60000, // ₹600 requested
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:C1:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Insufficient available balance/i
      );

      // Verify wallet was not debited
      const wallet = await Wallet.findOne({ userId: "USR_C1" });
      assert.strictEqual(wallet.availablePaisa, 50000);
    });

    it("C2: Should allow exact balance withdrawal", async () => {
      await createTestUser({ userId: "USR_C2", initialAvailablePaisa: 50000 }); // ₹500 available
      const result = await withdrawalService.requestWithdrawal({
        userId: "USR_C2",
        amountPaisa: 50000, // exactly ₹500
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:C2:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(result.withdrawal.amountPaisa, 50000);
      const wallet = await Wallet.findOne({ userId: "USR_C2" });
      assert.strictEqual(wallet.availablePaisa, 0);
    });

    it("C3: Should reject withdrawal when balance is zero", async () => {
      await createTestUser({ userId: "USR_C3", initialAvailablePaisa: 0 });
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_C3",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:C3:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Insufficient available balance/i
      );
    });

    it("C4: Reservation must correctly debit USER:AVAILABLE and credit SYSTEM:WITHDRAWAL_HOLD in ledger", async () => {
      await createTestUser({ userId: "USR_C4", initialAvailablePaisa: 100000 });
      const result = await withdrawalService.requestWithdrawal({
        userId: "USR_C4",
        amountPaisa: 60000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:C4:1",
        testRuleOverride: confirmedTestRule,
      });

      const journal = await JournalEntry.findById(result.withdrawal.holdJournalId);
      assert.ok(journal);
      assert.strictEqual(journal.status, JOURNAL_STATUS.COMMITTED);
      assert.strictEqual(journal.eventType, JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD);

      const postings = await LedgerPosting.find({ journalId: journal._id });
      assert.strictEqual(postings.length, 2);

      const debitPosting = postings.find((p) => p.direction === POSTING_DIRECTION.DEBIT);
      const creditPosting = postings.find((p) => p.direction === POSTING_DIRECTION.CREDIT);

      assert.strictEqual(debitPosting.accountId, "USER:USR_C4:AVAILABLE_INCOME");
      assert.strictEqual(debitPosting.amountPaisa, 60000);

      assert.strictEqual(creditPosting.accountId, "SYSTEM:WITHDRAWAL_HOLD");
      assert.strictEqual(creditPosting.amountPaisa, 60000);
    });
  });

  // =========================================================================
  // CATEGORY D — RULE GATING (PRODUCTION BLOCKED)
  // =========================================================================
  describe("Category D: Business Rule Gating", () => {
    it("D1: Default production execution must remain strictly BLOCKED without client confirmation", async () => {
      await createTestUser({ userId: "USR_D1", initialAvailablePaisa: 100000 });
      // Call without testRuleOverride $\to$ uses authoritative Phase 0 businessPlanConfig.js
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_D1",
            amountPaisa: 50000,
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:D1:1",
          });
        },
        /Withdrawal blocked: Withdrawal rules require authoritative client confirmation/i
      );

      // Verify zero wallet mutation
      const wallet = await Wallet.findOne({ userId: "USR_D1" });
      assert.strictEqual(wallet.availablePaisa, 100000);
    });

    it("D2: Rejection when amount is below minimum withdrawal threshold", async () => {
      await createTestUser({ userId: "USR_D2", initialAvailablePaisa: 100000 });
      // Minimum is ₹500 (50,000 paisa)
      await assert.rejects(
        async () => {
          await withdrawalService.requestWithdrawal({
            userId: "USR_D2",
            amountPaisa: 40000, // ₹400
            destinationType: DESTINATION_TYPES.BANK_TRANSFER,
            destinationReference: "SBIN0001234:11223344",
            idempotencyKey: "IDEMP:D2:1",
            testRuleOverride: confirmedTestRule,
          });
        },
        /Withdrawal amount must be at least ₹500/i
      );
    });
  });

  // =========================================================================
  // CATEGORY E — DETERMINISTIC FEE CALCULATION
  // =========================================================================
  describe("Category E: Deterministic Server-Side Fee Calculation", () => {
    it("E1: Correctly calculates 5% processing fee and net amount in integer Paisa", async () => {
      await createTestUser({ userId: "USR_E1", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_E1",
        amountPaisa: 100000, // ₹1,000
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:E1:1",
        testRuleOverride: confirmedTestRule,
      });

      // 5% of 100,000 = 5,000 paisa (₹50)
      assert.strictEqual(withdrawal.amountPaisa, 100000);
      assert.strictEqual(withdrawal.feePaisa, 5000);
      assert.strictEqual(withdrawal.netAmountPaisa, 95000);
      assert.strictEqual(withdrawal.calculationSnapshot.feePercentage, 5.0);
    });

    it("E2: Correct integer rounding on fractional fee paisa", async () => {
      // 5% of 50,001 paisa = 2,500.05 -> Math.round -> 2,500 paisa
      const { feePaisa, netAmountPaisa } = withdrawalService.calculateFeePaisa(50001, 5.0);
      assert.strictEqual(feePaisa, 2500);
      assert.strictEqual(netAmountPaisa, 47501);
      assert.strictEqual(feePaisa + netAmountPaisa, 50001);
    });
  });

  // =========================================================================
  // CATEGORY F — DETERMINISTIC IDEMPOTENCY
  // =========================================================================
  describe("Category F: Idempotency Protection", () => {
    it("F1: Replay of same idempotency key returns existing withdrawal without double-reservation", async () => {
      await createTestUser({ userId: "USR_F1", initialAvailablePaisa: 100000 });
      const reqPayload = {
        userId: "USR_F1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:F1:DUPLICATE_TEST",
        testRuleOverride: confirmedTestRule,
      };

      const res1 = await withdrawalService.requestWithdrawal(reqPayload);
      assert.strictEqual(res1.isReplay, false);

      const walletAfterFirst = await Wallet.findOne({ userId: "USR_F1" });
      assert.strictEqual(walletAfterFirst.availablePaisa, 50000);

      // Submit identical request
      const res2 = await withdrawalService.requestWithdrawal(reqPayload);
      assert.strictEqual(res2.isReplay, true);
      assert.strictEqual(res2.withdrawal._id.toString(), res1.withdrawal._id.toString());

      // Wallet must NOT be debited twice
      const walletAfterSecond = await Wallet.findOne({ userId: "USR_F1" });
      assert.strictEqual(walletAfterSecond.availablePaisa, 50000);
    });

    it("F2: Replay of idempotency key after approval returns existing approved withdrawal", async () => {
      await createTestUser({ userId: "USR_F2", initialAvailablePaisa: 100000 });
      const reqPayload = {
        userId: "USR_F2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:F2:APPROVAL_TEST",
        testRuleOverride: confirmedTestRule,
      };

      const res1 = await withdrawalService.requestWithdrawal(reqPayload);
      await withdrawalService.startReview({ withdrawalId: res1.withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.approveWithdrawal({ withdrawalId: res1.withdrawal._id, adminUserId: "ADMIN_01" });

      const res2 = await withdrawalService.requestWithdrawal(reqPayload);
      assert.strictEqual(res2.isReplay, true);
      assert.strictEqual(res2.withdrawal.status, WITHDRAWAL_STATUS.APPROVED);
    });
  });

  // =========================================================================
  // CATEGORY G — STATE MACHINE TRANSITIONS & CORRECTIONS
  // =========================================================================
  describe("Category G: State Machine Transitions & Strict Review Gate", () => {
    it("G1 (CORRECTION): Direct REQUESTED -> APPROVED transition MUST be REJECTED", async () => {
      await createTestUser({ userId: "USR_G1", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G1:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(withdrawal.status, WITHDRAWAL_STATUS.REQUESTED);

      // Attempt direct approval without review
      await assert.rejects(
        async () => {
          await withdrawalService.approveWithdrawal({
            withdrawalId: withdrawal._id,
            adminUserId: "ADMIN_01",
          });
        },
        /Invalid withdrawal state transition from REQUESTED to APPROVED/i
      );

      // Status must remain REQUESTED
      const current = await Withdrawal.findById(withdrawal._id);
      assert.strictEqual(current.status, WITHDRAWAL_STATUS.REQUESTED);
    });

    it("G2: Valid full lifecycle: REQUESTED -> UNDER_REVIEW -> APPROVED -> PROCESSING -> COMPLETED", async () => {
      await createTestUser({ userId: "USR_G2", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G2:1",
        testRuleOverride: confirmedTestRule,
      });

      // 1. Review
      const underReview = await withdrawalService.startReview({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
      });
      assert.strictEqual(underReview.status, WITHDRAWAL_STATUS.UNDER_REVIEW);
      assert.strictEqual(underReview.reviewedBy, "ADMIN_01");

      // 2. Approve
      const approved = await withdrawalService.approveWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
      });
      assert.strictEqual(approved.status, WITHDRAWAL_STATUS.APPROVED);
      assert.strictEqual(approved.approvedBy, "ADMIN_01");

      // 3. Process Payout
      const completed = await withdrawalService.processPayout({
        withdrawalId: withdrawal._id,
      });
      assert.strictEqual(completed.status, WITHDRAWAL_STATUS.COMPLETED);
      assert.ok(completed.completedAt);
      assert.ok(completed.providerReference.startsWith("PAYOUT:SANDBOX:"));
      assert.ok(completed.settlementJournalId);
    });

    it("G3: Rejection from REQUESTED: REQUESTED -> REJECTED reverses hold", async () => {
      await createTestUser({ userId: "USR_G3", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G3",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G3:1",
        testRuleOverride: confirmedTestRule,
      });

      // Wallet debited to 50,000
      let wallet = await Wallet.findOne({ userId: "USR_G3" });
      assert.strictEqual(wallet.availablePaisa, 50000);

      // Admin rejects directly from REQUESTED
      const rejected = await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
        rejectionReason: "Invalid IFSC code",
      });

      assert.strictEqual(rejected.status, WITHDRAWAL_STATUS.REJECTED);
      assert.strictEqual(rejected.rejectionReason, "Invalid IFSC code");
      assert.ok(rejected.reversalJournalId);

      // Wallet balance must be restored to 100,000
      wallet = await Wallet.findOne({ userId: "USR_G3" });
      assert.strictEqual(wallet.availablePaisa, 100000);
    });

    it("G4: Rejection from UNDER_REVIEW: UNDER_REVIEW -> REJECTED reverses hold", async () => {
      await createTestUser({ userId: "USR_G4", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G4",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G4:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
      });

      const rejected = await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
        rejectionReason: "Bank account name mismatch",
      });

      assert.strictEqual(rejected.status, WITHDRAWAL_STATUS.REJECTED);
      const wallet = await Wallet.findOne({ userId: "USR_G4" });
      assert.strictEqual(wallet.availablePaisa, 100000);
    });

    it("G5: Invalid transition: COMPLETED -> REQUESTED must be rejected", async () => {
      await createTestUser({ userId: "USR_G5", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G5",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G5:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.processPayout({ withdrawalId: withdrawal._id });

      await assert.rejects(
        async () => {
          await withdrawalService.approveWithdrawal({
            withdrawalId: withdrawal._id,
            adminUserId: "ADMIN_01",
          });
        },
        /Invalid withdrawal state transition from COMPLETED to APPROVED/i
      );
    });

    it("G6: Invalid transition: REJECTED -> PROCESSING must be rejected", async () => {
      await createTestUser({ userId: "USR_G6", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_G6",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:G6:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
        rejectionReason: "Test reject",
      });

      await assert.rejects(
        async () => {
          await withdrawalService.processPayout({
            withdrawalId: withdrawal._id,
          });
        },
        /Invalid withdrawal state transition from REJECTED to PROCESSING/i
      );
    });
  });

  // =========================================================================
  // CATEGORY H — DOUBLE-ENTRY LEDGER ACCOUNTING
  // =========================================================================
  describe("Category H: Double-Entry Accounting Invariants", () => {
    it("H1: Settlement journal must debit SYSTEM:WITHDRAWAL_HOLD and credit SYSTEM:PAYMENT_CLEARING", async () => {
      await createTestUser({ userId: "USR_H1", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_H1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:H1:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      const completed = await withdrawalService.processPayout({ withdrawalId: withdrawal._id });

      const settlementJournal = await JournalEntry.findById(completed.settlementJournalId);
      assert.ok(settlementJournal);
      assert.strictEqual(settlementJournal.status, JOURNAL_STATUS.COMMITTED);
      assert.strictEqual(settlementJournal.eventType, JOURNAL_EVENT_TYPES.WITHDRAWAL_SETTLED);

      const postings = await LedgerPosting.find({ journalId: settlementJournal._id });
      assert.strictEqual(postings.length, 2);

      const debit = postings.find((p) => p.direction === POSTING_DIRECTION.DEBIT);
      const credit = postings.find((p) => p.direction === POSTING_DIRECTION.CREDIT);

      assert.strictEqual(debit.accountId, "SYSTEM:WITHDRAWAL_HOLD");
      assert.strictEqual(debit.amountPaisa, 50000);

      assert.strictEqual(credit.accountId, "SYSTEM:PAYMENT_CLEARING");
      assert.strictEqual(credit.amountPaisa, 50000);
    });

    it("H2: Reversal journal must be mathematically balanced (totalDebits === totalCredits)", async () => {
      await createTestUser({ userId: "USR_H2", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_H2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:H2:1",
        testRuleOverride: confirmedTestRule,
      });

      const rejected = await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
        rejectionReason: "Test",
      });

      const reversalJournal = await JournalEntry.findById(rejected.reversalJournalId);
      const postings = await LedgerPosting.find({ journalId: reversalJournal._id });

      let sumDebits = 0;
      let sumCredits = 0;
      for (const p of postings) {
        if (p.direction === POSTING_DIRECTION.DEBIT) sumDebits += p.amountPaisa;
        if (p.direction === POSTING_DIRECTION.CREDIT) sumCredits += p.amountPaisa;
      }

      assert.strictEqual(sumDebits, sumCredits);
      assert.strictEqual(sumDebits, 50000);
    });
  });

  // =========================================================================
  // CATEGORY I — ADMIN RBAC & SECURITY RESTRICTIONS
  // =========================================================================
  describe("Category I: Admin RBAC & Financial Mutation Lockdown", () => {
    it("I1: Non-admin member cannot access admin withdrawal listing", async () => {
      await createTestUser({ userId: "USR_I1" });
      await assert.rejects(
        async () => {
          await withdrawalService.getWithdrawalById("65f1a2b3c4d5e6f7a8b9c0d1", "USR_I1", "user");
        },
        /Withdrawal not found/i // First checks existence
      );
    });

    it("I2: Member user cannot view another member's withdrawal", async () => {
      await createTestUser({ userId: "USR_I2_A", initialAvailablePaisa: 100000 });
      await createTestUser({ userId: "USR_I2_B" });

      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_I2_A",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:I2:1",
        testRuleOverride: confirmedTestRule,
      });

      await assert.rejects(
        async () => {
          await withdrawalService.getWithdrawalById(withdrawal._id, "USR_I2_B", "user");
        },
        /Unauthorized access to withdrawal record/i
      );
    });

    it("I3: Admin can view any member's withdrawal", async () => {
      await createTestUser({ userId: "USR_I3", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_I3",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:I3:1",
        testRuleOverride: confirmedTestRule,
      });

      const fetched = await withdrawalService.getWithdrawalById(withdrawal._id, "ADMIN_01", "admin");
      assert.strictEqual(fetched._id.toString(), withdrawal._id.toString());
    });
  });

  // =========================================================================
  // CATEGORY J — PAYOUT PROVIDER ADAPTER & SIMULATED FAILURE
  // =========================================================================
  describe("Category J: Payout Provider Adapter & Failure Handling", () => {
    it("J1: Sandbox payout adapter returns unmistakable SANDBOX indicator and deterministic reference", async () => {
      await createTestUser({ userId: "USR_J1", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_J1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:J1:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });

      const adapter = new SandboxPayoutAdapter();
      const completed = await withdrawalService.processPayout({
        withdrawalId: withdrawal._id,
        customProvider: adapter,
      });

      assert.strictEqual(completed.status, WITHDRAWAL_STATUS.COMPLETED);
      assert.strictEqual(completed.providerReference, `PAYOUT:SANDBOX:${withdrawal._id}`);
    });

    it("J2: Provider failure transitions to FAILED and automatically releases the hold", async () => {
      await createTestUser({ userId: "USR_J2", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_J2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:J2:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_01" });

      // Configure simulated provider failure
      const failingAdapter = new SandboxPayoutAdapter({
        shouldFail: true,
        failureMessage: "Bank server network timeout",
      });

      const failed = await withdrawalService.processPayout({
        withdrawalId: withdrawal._id,
        customProvider: failingAdapter,
      });

      assert.strictEqual(failed.status, WITHDRAWAL_STATUS.FAILED);
      assert.strictEqual(failed.failureReason, "Bank server network timeout");
      assert.ok(failed.reversalJournalId);

      // Verify wallet balance restored
      const wallet = await Wallet.findOne({ userId: "USR_J2" });
      assert.strictEqual(wallet.availablePaisa, 100000);
    });
  });

  // =========================================================================
  // CATEGORY K — RECONCILIATION INTEGRATION
  // =========================================================================
  describe("Category K: Reconciliation Integration & Zero Silent Repairs", () => {
    it("K1: User wallet remains 100% BALANCED after withdrawal reservation", async () => {
      await createTestUser({ userId: "USR_K1", initialAvailablePaisa: 100000 });
      await withdrawalService.requestWithdrawal({
        userId: "USR_K1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:K1:1",
        testRuleOverride: confirmedTestRule,
      });

      const recon = await reconciliationService.reconcileUser("USR_K1");
      assert.strictEqual(recon.status, "BALANCED");
      assert.strictEqual(recon.discrepancyPaisa, 0);
      assert.strictEqual(recon.calculatedLedgerSumPaisa, 50000); // 100,000 credit - 50,000 debit = 50,000
      assert.strictEqual(recon.walletProjectionPaisa, 50000);
    });

    it("K2: User wallet remains 100% BALANCED after rejection and reversal", async () => {
      await createTestUser({ userId: "USR_K2", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_K2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:K2:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_01",
        rejectionReason: "Test",
      });

      const recon = await reconciliationService.reconcileUser("USR_K2");
      assert.strictEqual(recon.status, "BALANCED");
      assert.strictEqual(recon.discrepancyPaisa, 0);
      assert.strictEqual(recon.calculatedLedgerSumPaisa, 100000);
      assert.strictEqual(recon.walletProjectionPaisa, 100000);
    });
  });

  // =========================================================================
  // CATEGORY L — CONCURRENCY & DOUBLE-SPEND PREVENTION
  // =========================================================================
  describe("Category L: Concurrency & Double-Spend Guards", () => {
    it("L1: Concurrent requests competing for same balance: only one succeeds, no overdraft", async () => {
      await createTestUser({ userId: "USR_L1", initialAvailablePaisa: 50000 }); // ₹500 available

      // Fire two concurrent ₹500 withdrawal requests
      const p1 = withdrawalService.requestWithdrawal({
        userId: "USR_L1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:L1:RACE_1",
        testRuleOverride: confirmedTestRule,
      });

      const p2 = withdrawalService.requestWithdrawal({
        userId: "USR_L1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:L1:RACE_2",
        testRuleOverride: confirmedTestRule,
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 1, "Exactly one concurrent withdrawal must succeed");
      assert.strictEqual(rejected.length, 1, "The competing request must be rejected for insufficient funds");

      // Balance must be 0, never negative
      const wallet = await Wallet.findOne({ userId: "USR_L1" });
      assert.strictEqual(wallet.availablePaisa, 0);
    });

    it("L2: Three concurrent requests when balance covers only two: exactly two succeed, zero negative balance", async () => {
      await createTestUser({ userId: "USR_L2", initialAvailablePaisa: 100000 }); // ₹1,000 available

      // Three concurrent ₹500 (50,000 paisa) requests
      const p1 = withdrawalService.requestWithdrawal({
        userId: "USR_L2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:L2:RACE_1",
        testRuleOverride: confirmedTestRule,
      });

      const p2 = withdrawalService.requestWithdrawal({
        userId: "USR_L2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:L2:RACE_2",
        testRuleOverride: confirmedTestRule,
      });

      const p3 = withdrawalService.requestWithdrawal({
        userId: "USR_L2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:L2:RACE_3",
        testRuleOverride: confirmedTestRule,
      });

      const results = await Promise.allSettled([p1, p2, p3]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.strictEqual(fulfilled.length, 2, "Exactly two concurrent withdrawals must succeed");
      assert.strictEqual(rejected.length, 1, "The third competing request must be rejected");

      const wallet = await Wallet.findOne({ userId: "USR_L2" });
      assert.strictEqual(wallet.availablePaisa, 0);
    });
  });

  // =========================================================================
  // CATEGORY M — HTTP CONTROLLER & AUDIT TRAIL VERIFICATION
  // =========================================================================
  describe("Category M: Pagination, Audit Trail & Query Filters", () => {
    it("M1: getUserWithdrawals returns paginated records sorted by createdAt desc", async () => {
      await createTestUser({ userId: "USR_M1", initialAvailablePaisa: 200000 });

      await withdrawalService.requestWithdrawal({
        userId: "USR_M1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M1:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.requestWithdrawal({
        userId: "USR_M1",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.USDT_TRC20,
        destinationReference: "TXyZ1234567890",
        idempotencyKey: "IDEMP:M1:2",
        testRuleOverride: confirmedTestRule,
      });

      const res = await withdrawalService.getUserWithdrawals("USR_M1", { page: 1, limit: 10 });
      assert.strictEqual(res.withdrawals.length, 2);
      assert.strictEqual(res.pagination.total, 2);
      assert.strictEqual(res.pagination.pages, 1);
    });

    it("M2: getAdminWithdrawals filters by status correctly", async () => {
      await createTestUser({ userId: "USR_M2", initialAvailablePaisa: 200000 });

      const w1 = await withdrawalService.requestWithdrawal({
        userId: "USR_M2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M2:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.requestWithdrawal({
        userId: "USR_M2",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.USDT_TRC20,
        destinationReference: "TXyZ1234567890",
        idempotencyKey: "IDEMP:M2:2",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: w1.withdrawal._id, adminUserId: "ADMIN_M2" });

      const requestedList = await withdrawalService.getAdminWithdrawals({ status: WITHDRAWAL_STATUS.REQUESTED });
      const underReviewList = await withdrawalService.getAdminWithdrawals({ status: WITHDRAWAL_STATUS.UNDER_REVIEW });

      assert.strictEqual(requestedList.withdrawals.length, 1);
      assert.strictEqual(underReviewList.withdrawals.length, 1);
      assert.strictEqual(underReviewList.withdrawals[0]._id.toString(), w1.withdrawal._id.toString());
    });

    it("M3: Complete audit trail exists across every lifecycle phase", async () => {
      await createTestUser({ userId: "USR_M3", initialAvailablePaisa: 100000 });

      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_M3",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M3:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_M3" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_M3" });
      await withdrawalService.processPayout({ withdrawalId: withdrawal._id });

      const logs = await AuditLog.find({ userId: "USR_M3" });
      const actions = logs.map((l) => l.action);

      assert.ok(actions.includes(WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REQUESTED));
      assert.ok(actions.includes(WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REVIEW_STARTED));
      assert.ok(actions.includes(WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_APPROVED));
      assert.ok(actions.includes(WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_PROCESSING));
      assert.ok(actions.includes(WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_COMPLETED));
    });

    it("M4: Rejection audit trail records rejection reason and hold release", async () => {
      await createTestUser({ userId: "USR_M4", initialAvailablePaisa: 100000 });

      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_M4",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M4:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.rejectWithdrawal({
        withdrawalId: withdrawal._id,
        adminUserId: "ADMIN_M4",
        rejectionReason: "Name mismatch with bank document",
      });

      const audit = await AuditLog.findOne({
        userId: "USR_M4",
        action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REJECTED,
      });
      assert.ok(audit);
      assert.ok(audit.details.includes("Name mismatch with bank document"));
    });

    it("M5: Payout failure audit trail records failure reason and hold release", async () => {
      await createTestUser({ userId: "USR_M5", initialAvailablePaisa: 100000 });

      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_M5",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M5:1",
        testRuleOverride: confirmedTestRule,
      });

      await withdrawalService.startReview({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_M5" });
      await withdrawalService.approveWithdrawal({ withdrawalId: withdrawal._id, adminUserId: "ADMIN_M5" });

      const failingAdapter = new SandboxPayoutAdapter({
        shouldFail: true,
        failureMessage: "Beneficiary bank account inactive",
      });

      await withdrawalService.processPayout({
        withdrawalId: withdrawal._id,
        customProvider: failingAdapter,
      });

      const audit = await AuditLog.findOne({
        userId: "USR_M5",
        action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_FAILED,
      });
      assert.ok(audit);
      assert.ok(audit.details.includes("Beneficiary bank account inactive"));
    });

    it("M6: Payout provider getPayoutStatus returns valid sandbox status", async () => {
      const adapter = new SandboxPayoutAdapter();
      const status = await adapter.getPayoutStatus("PAYOUT:SANDBOX:123");
      assert.strictEqual(status.status, "COMPLETED");
      assert.strictEqual(status.isSandbox, true);
    });

    it("M7: ProductionPayoutAdapter strictly rejects createPayout with 503", async () => {
      const { ProductionPayoutAdapter } = await import("../src/services/withdrawal/payoutProvider.js");
      const prodAdapter = new ProductionPayoutAdapter();
      await assert.rejects(
        async () => {
          await prodAdapter.createPayout({});
        },
        /Production payout provider is not configured.*BLOCKED/i
      );
    });

    it("M8: ProductionPayoutAdapter strictly rejects getPayoutStatus with 503", async () => {
      const { ProductionPayoutAdapter } = await import("../src/services/withdrawal/payoutProvider.js");
      const prodAdapter = new ProductionPayoutAdapter();
      await assert.rejects(
        async () => {
          await prodAdapter.getPayoutStatus("REF_123");
        },
        /Production payout provider is not configured/i
      );
    });

    it("M9: Calculation snapshot grossAmountPaisa matches amountPaisa exactly", async () => {
      await createTestUser({ userId: "USR_M9", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_M9",
        amountPaisa: 75000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M9:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(withdrawal.calculationSnapshot.grossAmountPaisa, 75000);
      assert.strictEqual(withdrawal.calculationSnapshot.currency, "INR");
    });

    it("M10: Calculation snapshot feePaisa + netAmountPaisa equals grossAmountPaisa exactly", async () => {
      await createTestUser({ userId: "USR_M10", initialAvailablePaisa: 100000 });
      const { withdrawal } = await withdrawalService.requestWithdrawal({
        userId: "USR_M10",
        amountPaisa: 99999,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M10:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(
        withdrawal.calculationSnapshot.feePaisa + withdrawal.calculationSnapshot.netAmountPaisa,
        withdrawal.calculationSnapshot.grossAmountPaisa
      );
    });

    it("M11: Replay with same idempotencyKey preserves original timestamps and status", async () => {
      await createTestUser({ userId: "USR_M11", initialAvailablePaisa: 100000 });
      const res1 = await withdrawalService.requestWithdrawal({
        userId: "USR_M11",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M11:1",
        testRuleOverride: confirmedTestRule,
      });

      const res2 = await withdrawalService.requestWithdrawal({
        userId: "USR_M11",
        amountPaisa: 50000,
        destinationType: DESTINATION_TYPES.BANK_TRANSFER,
        destinationReference: "SBIN0001234:11223344",
        idempotencyKey: "IDEMP:M11:1",
        testRuleOverride: confirmedTestRule,
      });

      assert.strictEqual(res2.isReplay, true);
      assert.strictEqual(
        new Date(res2.withdrawal.requestedAt).getTime(),
        new Date(res1.withdrawal.requestedAt).getTime()
      );
    });

    it("M12: Non-existent withdrawalId throws 404 in startReview", async () => {
      await assert.rejects(
        async () => {
          await withdrawalService.startReview({
            withdrawalId: new mongoose.Types.ObjectId(),
            adminUserId: "ADMIN_M12",
          });
        },
        /Withdrawal not found/i
      );
    });

    it("M13: Non-existent withdrawalId throws 404 in approveWithdrawal", async () => {
      await assert.rejects(
        async () => {
          await withdrawalService.approveWithdrawal({
            withdrawalId: new mongoose.Types.ObjectId(),
            adminUserId: "ADMIN_M13",
          });
        },
        /Withdrawal not found/i
      );
    });

    it("M14: Non-existent withdrawalId throws 404 in rejectWithdrawal", async () => {
      await assert.rejects(
        async () => {
          await withdrawalService.rejectWithdrawal({
            withdrawalId: new mongoose.Types.ObjectId(),
            adminUserId: "ADMIN_M14",
            rejectionReason: "Test",
          });
        },
        /Withdrawal not found/i
      );
    });

    it("M15: Non-existent withdrawalId throws 404 in processPayout", async () => {
      await assert.rejects(
        async () => {
          await withdrawalService.processPayout({
            withdrawalId: new mongoose.Types.ObjectId(),
          });
        },
        /Withdrawal not found/i
      );
    });
  });
});
