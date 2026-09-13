/**
 * Green Future Tech (GFT) — Phase 4 Test Suite
 * Wallet Architecture, Immutable Double-Entry Ledger, Idempotency & Financial Safety
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
import Transaction from "../src/models/Transaction.js";
import TokenSupply from "../src/models/TokenSupply.js";

// Services and Utilities
import ledgerService from "../src/services/ledgerService.js";
import reconciliationService from "../src/services/reconciliationService.js";
import walletService from "../src/services/walletService.js";
import { parseToPaisa, formatPaisaToRupees, parseTokenUnits } from "../src/utils/money.js";
import { UnconfirmedBusinessRuleError } from "../src/utils/errors.js";
import {
  JOURNAL_STATUS,
  POSTING_DIRECTION,
  ACCOUNT_TYPES,
  JOURNAL_EVENT_TYPES,
  TOKEN_PRECISION,
} from "../src/utils/rules/ledgerConstants.js";

const TEST_MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gft-db";

describe("PHASE 4 — WALLET & IMMUTABLE LEDGER FOUNDATION", async () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGODB_URI);
    }
    // Clean up any artifacts from previous runs before starting via native driver
    await mongoose.connection.collection("wallets").dropIndex("user_1").catch(() => {});
    await mongoose.connection.collection("journalentries").deleteMany({ referenceId: /^TEST-P4/ }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ accountId: /^TEST-P4/ }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p4_/ }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p4_/ }).catch(() => {});
  });

  after(async () => {
    // Cleanup Phase 4 test artifacts via native driver
    await mongoose.connection.collection("journalentries").deleteMany({ referenceId: /^TEST-P4/ }).catch(() => {});
    await mongoose.connection.collection("ledgerpostings").deleteMany({ accountId: /^TEST-P4/ }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^test_p4_/ }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^test_p4_/ }).catch(() => {});
  });

  // ==========================================
  // SECTION 1: DETERMINISTIC MONEY PARSING
  // ==========================================

  test("1. parseToPaisa parses '1500.25' to 150025 paisa", () => {
    assert.strictEqual(parseToPaisa("1500.25"), 150025);
  });

  test("2. parseToPaisa parses '100' to 10000 paisa", () => {
    assert.strictEqual(parseToPaisa("100"), 10000);
    assert.strictEqual(parseToPaisa(100), 10000);
    assert.strictEqual(parseToPaisa("100.5"), 10050);
    assert.strictEqual(parseToPaisa("0.05"), 5);
  });

  test("3. parseToPaisa rejects amounts with more than 2 decimal places", () => {
    assert.throws(
      () => parseToPaisa("1500.255"),
      /at most 2 decimal places/
    );
    assert.throws(
      () => parseToPaisa("10.1234"),
      /at most 2 decimal places/
    );
  });

  test("4. parseToPaisa rejects malformed inputs and empty strings", () => {
    assert.throws(() => parseToPaisa(""), /cannot be empty/);
    assert.throws(() => parseToPaisa("abc"), /numeric with at most 2 decimal places/);
    assert.throws(() => parseToPaisa("1,500.00"), /numeric with at most 2 decimal places/);
    assert.throws(() => parseToPaisa("$100"), /numeric with at most 2 decimal places/);
  });

  test("5. parseToPaisa rejects NaN", () => {
    assert.throws(() => parseToPaisa(NaN), /NaN or Infinity is rejected/);
  });

  test("6. parseToPaisa rejects Infinity and -Infinity", () => {
    assert.throws(() => parseToPaisa(Infinity), /NaN or Infinity is rejected/);
    assert.throws(() => parseToPaisa(-Infinity), /NaN or Infinity is rejected/);
  });

  test("7. parseToPaisa rejects negative amounts by default", () => {
    assert.throws(() => parseToPaisa("-500"), /Negative amounts are not permitted/);
    assert.throws(() => parseToPaisa("-0.01"), /Negative amounts are not permitted/);
  });

  test("8. parseToPaisa rejects unsafe integers exceeding safe integer limits", () => {
    assert.throws(
      () => parseToPaisa("99999999999999999999999999.00"),
      /exceeds safe integer range/
    );
  });

  test("9. GFT token precision remains strictly unconfirmed placeholder", () => {
    assert.strictEqual(TOKEN_PRECISION, "REQUIRES_CLIENT_CONFIRMATION");
    assert.throws(
      () => parseTokenUnits("100"),
      UnconfirmedBusinessRuleError
    );
  });

  test("9b. formatPaisaToRupees deterministically formats paisa to INR string", () => {
    assert.strictEqual(formatPaisaToRupees(150025), "1500.25");
    assert.strictEqual(formatPaisaToRupees(10000), "100.00");
    assert.strictEqual(formatPaisaToRupees(5), "0.05");
    assert.strictEqual(formatPaisaToRupees(0), "0.00");
  });

  // ==========================================
  // SECTION 2: DOUBLE-ENTRY EQUILIBRIUM & BALANCED POSTINGS
  // ==========================================

  test("10. Unbalanced double-entry journal is rejected before write (Debits != Credits)", async () => {
    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: "TEST-P4-IMBALANCED-001",
          referenceId: "TEST-P4-REF-001",
          eventType: JOURNAL_EVENT_TYPES.MANUAL_DEPOSIT,
          description: "Imbalanced test entry",
          postings: [
            {
              accountId: "USER:test_p4_user1:AVAILABLE_INCOME",
              userId: "test_p4_user1",
              currency: "INR",
              amountPaisa: 50000, // ₹500
              direction: POSTING_DIRECTION.CREDIT,
            },
            {
              accountId: "SYSTEM:PAYMENT_CLEARING",
              currency: "INR",
              amountPaisa: 40000, // ₹400 (Mismatch!)
              direction: POSTING_DIRECTION.DEBIT,
            },
          ],
        });
      },
      /Total debits \(40000\) must equal total credits \(50000\)/
    );
  });

  // ==========================================
  // SECTION 3: VALID CREDIT & ATOMIC PROJECTION
  // ==========================================

  test("11. Valid credit creates balanced postings and updates wallet projection", async () => {
    const userId = "test_p4_user_credit_001";
    const amountPaisa = 100000; // ₹1,000

    const result = await ledgerService.recordJournalEntry({
      idempotencyKey: "TEST-P4-CREDIT-IDEM-001",
      referenceId: "TEST-P4-CREDIT-REF-001",
      eventType: JOURNAL_EVENT_TYPES.MANUAL_DEPOSIT,
      description: "Credit ₹1,000 to user available wallet",
      postings: [
        {
          accountId: `USER:${userId}:AVAILABLE_INCOME`,
          userId,
          walletType: "AVAILABLE_INCOME",
          currency: "INR",
          amountPaisa,
          direction: POSTING_DIRECTION.CREDIT,
        },
        {
          accountId: "SYSTEM:PAYMENT_CLEARING",
          walletType: "SYSTEM_CLEARING",
          currency: "INR",
          amountPaisa,
          direction: POSTING_DIRECTION.DEBIT,
        },
      ],
    });

    assert.strictEqual(result.isReplay, false);
    assert.strictEqual(result.journal.status, JOURNAL_STATUS.COMMITTED);
    assert.strictEqual(result.postings.length, 2);

    // Verify wallet projection
    const wallet = await Wallet.findOne({ userId });
    assert.strictEqual(wallet.availablePaisa, 100000);
    assert.strictEqual(wallet.totalEarnedPaisa, 100000);
    assert.strictEqual(wallet.version >= 1, true);
  });

  // ==========================================
  // SECTION 4: VALID DEBIT & ATOMIC PROJECTION
  // ==========================================

  test("12. Valid debit decreases user available balance atomically", async () => {
    const userId = "test_p4_user_credit_001"; // Has 100,000 paisa
    const debitPaisa = 40000; // ₹400

    const result = await ledgerService.recordJournalEntry({
      idempotencyKey: "TEST-P4-DEBIT-IDEM-001",
      referenceId: "TEST-P4-DEBIT-REF-001",
      eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
      description: "Debit ₹400 for withdrawal hold",
      postings: [
        {
          accountId: `USER:${userId}:AVAILABLE_INCOME`,
          userId,
          walletType: "AVAILABLE_INCOME",
          currency: "INR",
          amountPaisa: debitPaisa,
          direction: POSTING_DIRECTION.DEBIT,
        },
        {
          accountId: "SYSTEM:WITHDRAWAL_HOLD",
          walletType: "SYSTEM_WITHDRAWAL_HOLD",
          currency: "INR",
          amountPaisa: debitPaisa,
          direction: POSTING_DIRECTION.CREDIT,
        },
      ],
    });

    assert.strictEqual(result.isReplay, false);
    assert.strictEqual(result.journal.status, JOURNAL_STATUS.COMMITTED);

    const wallet = await Wallet.findOne({ userId });
    assert.strictEqual(wallet.availablePaisa, 60000); // 100000 - 40000 = 60000 paisa (₹600)
  });

  // ==========================================
  // SECTION 5: INSUFFICIENT BALANCE & NON-NEGATIVE GUARD
  // ==========================================

  test("13. Insufficient balance rejects debit and prevents negative balance", async () => {
    const userId = "test_p4_user_credit_001"; // Has 60,000 paisa
    const excessiveDebitPaisa = 90000; // ₹900 (Exceeds ₹600!)

    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: "TEST-P4-EXCESSIVE-DEBIT-IDEM",
          referenceId: "TEST-P4-EXCESSIVE-DEBIT-REF",
          eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
          description: "Attempt excessive debit",
          postings: [
            {
              accountId: `USER:${userId}:AVAILABLE_INCOME`,
              userId,
              walletType: "AVAILABLE_INCOME",
              currency: "INR",
              amountPaisa: excessiveDebitPaisa,
              direction: POSTING_DIRECTION.DEBIT,
            },
            {
              accountId: "SYSTEM:WITHDRAWAL_HOLD",
              walletType: "SYSTEM_WITHDRAWAL_HOLD",
              currency: "INR",
              amountPaisa: excessiveDebitPaisa,
              direction: POSTING_DIRECTION.CREDIT,
            },
          ],
        });
      },
      /Insufficient available balance/
    );

    // Verify wallet was NOT altered
    const wallet = await Wallet.findOne({ userId });
    assert.strictEqual(wallet.availablePaisa, 60000); // Still ₹600!
  });

  test("14. Balance never becomes negative under any debit attempt", async () => {
    const wallet = await Wallet.findOne({ userId: "test_p4_user_credit_001" });
    assert(wallet.availablePaisa >= 0, "Available balance must never be negative.");
  });

  // ==========================================
  // SECTION 6: IDEMPOTENCY PROTECTION
  // ==========================================

  test("15. Duplicate idempotency key returns original result without duplicate balance change", async () => {
    const userId = "test_p4_user_credit_001";
    const walletBefore = await Wallet.findOne({ userId });

    // Replay the debit with identical idempotencyKey
    const replayResult = await ledgerService.recordJournalEntry({
      idempotencyKey: "TEST-P4-DEBIT-IDEM-001",
      referenceId: "TEST-P4-DEBIT-REF-001",
      eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
      description: "Debit ₹400 for withdrawal hold (Replay)",
      postings: [
        {
          accountId: `USER:${userId}:AVAILABLE_INCOME`,
          userId,
          walletType: "AVAILABLE_INCOME",
          currency: "INR",
          amountPaisa: 40000,
          direction: POSTING_DIRECTION.DEBIT,
        },
        {
          accountId: "SYSTEM:WITHDRAWAL_HOLD",
          walletType: "SYSTEM_WITHDRAWAL_HOLD",
          currency: "INR",
          amountPaisa: 40000,
          direction: POSTING_DIRECTION.CREDIT,
        },
      ],
    });

    assert.strictEqual(replayResult.isReplay, true);
    assert.strictEqual(replayResult.journal.status, JOURNAL_STATUS.COMMITTED);

    const walletAfter = await Wallet.findOne({ userId });
    assert.strictEqual(walletAfter.availablePaisa, walletBefore.availablePaisa, "Balance must NOT change on replay!");
  });

  test("16. Conflicting idempotency key for same referenceId is rejected with HTTP 409", async () => {
    await assert.rejects(
      async () => {
        await ledgerService.recordJournalEntry({
          idempotencyKey: "TEST-P4-DIFFERENT-IDEM-KEY",
          referenceId: "TEST-P4-DEBIT-REF-001", // Existing reference!
          eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
          description: "Conflicting idempotency key",
          postings: [
            {
              accountId: "USER:test_p4_user_credit_001:AVAILABLE_INCOME",
              userId: "test_p4_user_credit_001",
              currency: "INR",
              amountPaisa: 10000,
              direction: POSTING_DIRECTION.DEBIT,
            },
            {
              accountId: "SYSTEM:WITHDRAWAL_HOLD",
              currency: "INR",
              amountPaisa: 10000,
              direction: POSTING_DIRECTION.CREDIT,
            },
          ],
        });
      },
      (err) => err.statusCode === 409 && /Conflicting idempotency key/.test(err.message)
    );
  });

  // ==========================================
  // SECTION 7: CONCURRENCY PROTECTION
  // ==========================================

  test("17. Concurrent debits competing for balance cannot produce negative balance", async () => {
    const userId = "test_p4_concurrent_debit_user";
    await Wallet.create({
      userId,
      availablePaisa: 50000, // ₹500
      lockedPaisa: 0,
      totalEarnedPaisa: 50000,
      version: 1,
    });

    // Launch 5 parallel debits of ₹200 (20,000 paisa) each
    // Only 2 should succeed (₹400), 3 should fail
    const debitPromises = Array.from({ length: 5 }, (_, i) =>
      ledgerService.recordJournalEntry({
        idempotencyKey: `TEST-P4-CONCURRENT-DEBIT-${i}`,
        referenceId: `TEST-P4-CONCURRENT-REF-${i}`,
        eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
        description: `Concurrent debit attempt ${i}`,
        postings: [
          {
            accountId: `USER:${userId}:AVAILABLE_INCOME`,
            userId,
            walletType: "AVAILABLE_INCOME",
            currency: "INR",
            amountPaisa: 20000,
            direction: POSTING_DIRECTION.DEBIT,
          },
          {
            accountId: "SYSTEM:WITHDRAWAL_HOLD",
            currency: "INR",
            amountPaisa: 20000,
            direction: POSTING_DIRECTION.CREDIT,
          },
        ],
      }).catch((err) => ({ error: err.message }))
    );

    const results = await Promise.all(debitPromises);
    const successes = results.filter((r) => !r.error);
    const failures = results.filter((r) => r.error);

    assert.strictEqual(successes.length, 2, "Exactly 2 debits must succeed");
    assert.strictEqual(failures.length, 3, "Remaining 3 debits must fail");

    const finalWallet = await Wallet.findOne({ userId });
    assert.strictEqual(finalWallet.availablePaisa, 10000); // Exactly ₹100 remaining
    assert(finalWallet.availablePaisa >= 0, "Balance must never be negative");
  });

  test("18. Concurrent credits are preserved atomically without lost updates", async () => {
    const userId = "test_p4_concurrent_credit_user";
    await Wallet.create({
      userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    // Launch 5 parallel credits of ₹100 (10,000 paisa) each
    const creditPromises = Array.from({ length: 5 }, (_, i) =>
      ledgerService.recordJournalEntry({
        idempotencyKey: `TEST-P4-CONCURRENT-CREDIT-${i}`,
        referenceId: `TEST-P4-CONCURRENT-CREDIT-REF-${i}`,
        eventType: JOURNAL_EVENT_TYPES.MANUAL_DEPOSIT,
        description: `Concurrent credit ${i}`,
        postings: [
          {
            accountId: `USER:${userId}:AVAILABLE_INCOME`,
            userId,
            walletType: "AVAILABLE_INCOME",
            currency: "INR",
            amountPaisa: 10000,
            direction: POSTING_DIRECTION.CREDIT,
          },
          {
            accountId: "SYSTEM:PAYMENT_CLEARING",
            currency: "INR",
            amountPaisa: 10000,
            direction: POSTING_DIRECTION.DEBIT,
          },
        ],
      })
    );

    await Promise.all(creditPromises);

    const finalWallet = await Wallet.findOne({ userId });
    assert.strictEqual(finalWallet.availablePaisa, 50000, "All 5 credits must accumulate to exactly 50,000 paisa");
    assert.strictEqual(finalWallet.totalEarnedPaisa, 50000);
  });

  // ==========================================
  // SECTION 8: IMMUTABILITY ENFORCEMENT
  // ==========================================

  test("19. Direct update on core fields of JournalEntry is blocked by immutability guard", async () => {
    await assert.rejects(
      async () => {
        await JournalEntry.updateOne(
          { idempotencyKey: "TEST-P4-CREDIT-IDEM-001" },
          { $set: { idempotencyKey: "TAMPERED-KEY" } }
        );
      },
      /Fatal: Core financial identifiers on JournalEntry are immutable/
    );
  });

  test("20. Direct deletion of JournalEntry and LedgerPosting is blocked", async () => {
    await assert.rejects(
      async () => {
        await JournalEntry.deleteOne({ idempotencyKey: "TEST-P4-CREDIT-IDEM-001" });
      },
      /Fatal: JournalEntry records are permanently immutable and cannot be deleted/
    );

    await assert.rejects(
      async () => {
        await LedgerPosting.deleteOne({ accountId: "USER:test_p4_user_credit_001:AVAILABLE_INCOME" });
      },
      /Fatal: LedgerPosting records are strictly immutable and cannot be deleted/
    );
  });

  // ==========================================
  // SECTION 9: NEUTRALIZED TRANSACTION HOOK
  // ==========================================

  test("21. Saving a Transaction does NOT trigger token bonus distribution or alter TokenSupply", async () => {
    // Check initial TokenSupply
    let supply = await TokenSupply.findOne({ key: "global_supply" });
    if (!supply) {
      supply = await TokenSupply.create({
        key: "global_supply",
        totalSupply: 1000000000,
        availableSupply: 1000000000,
        distributedBonuses: 0,
      });
    }

    const availableBefore = supply.availableSupply;
    const distributedBefore = supply.distributedBonuses;

    // Create a Transaction that previously triggered token distribution
    const dummyUser = new mongoose.Types.ObjectId();
    await Transaction.create({
      user: dummyUser,
      userId: "test_p4_dummy_user",
      amount: 15000, // ₹15,000 INR
      currency: "INR",
      type: "credit",
      category: "direct_income", // previously in bonusCategories!
      status: "completed",
      description: "Direct commission transaction",
      referenceId: "TEST-REF-999",
    });

    // Check TokenSupply after save
    const supplyAfter = await TokenSupply.findOne({ key: "global_supply" });
    assert.strictEqual(
      supplyAfter.availableSupply,
      availableBefore,
      "availableSupply must NOT be altered by saving a Transaction!"
    );
    assert.strictEqual(
      supplyAfter.distributedBonuses,
      distributedBefore,
      "distributedBonuses must NOT be altered by saving a Transaction!"
    );
  });

  // ==========================================
  // SECTION 10: LEGACY PATH LOCKDOWN
  // ==========================================

  test("22. walletService.purchasePackage returns HTTP 410 Deprecated", async () => {
    await assert.rejects(
      async () => {
        await walletService.purchasePackage("test_p4_dummy_user", "pkg_1");
      },
      (err) => err.statusCode === 410 && /deprecated/.test(err.message)
    );
  });

  test("23. walletService.transferTokens is disabled with HTTP 403", async () => {
    await assert.rejects(
      async () => {
        await walletService.transferTokens("user1", "user2", 100);
      },
      (err) => err.statusCode === 403 && /disabled pending confirmed token economics/.test(err.message)
    );
  });

  test("24. walletService withdrawal operations are disabled with HTTP 403", async () => {
    await assert.rejects(
      async () => {
        await walletService.requestWithdrawal("user1", 500, "BANK_TRANSFER", "details");
      },
      (err) => err.statusCode === 403 && /disabled in Phase 4/.test(err.message)
    );

    await assert.rejects(
      async () => {
        await walletService.approveWithdrawal("some_withdrawal_id");
      },
      (err) => err.statusCode === 403 && /disabled in Phase 4/.test(err.message)
    );

    await assert.rejects(
      async () => {
        await walletService.rejectWithdrawal("some_withdrawal_id", "reason");
      },
      (err) => err.statusCode === 403 && /disabled in Phase 4/.test(err.message)
    );
  });

  // ==========================================
  // SECTION 11: RECONCILIATION DETECTION
  // ==========================================

  test("25. reconciliationService correctly reports BALANCED for in-sync user", async () => {
    const report = await reconciliationService.reconcileUser("test_p4_user_credit_001");
    assert.strictEqual(report.status, "BALANCED");
    assert.strictEqual(report.discrepancyPaisa, 0);
  });

  test("26. reconciliationService detects discrepancy and does NOT silently alter money", async () => {
    const userId = "test_p4_discrepancy_user";
    // Create wallet with synthetic mismatch
    await Wallet.create({
      user: new mongoose.Types.ObjectId(),
      userId,
      availablePaisa: 99999, // Artificially set to 99999 paisa without ledger postings
      lockedPaisa: 0,
      totalEarnedPaisa: 99999,
      version: 1,
    });

    const report = await reconciliationService.reconcileUser(userId);
    assert.strictEqual(report.status, "DISCREPANCY_DETECTED");
    assert.strictEqual(report.discrepancyPaisa, 99999);
    assert.strictEqual(report.calculatedLedgerSumPaisa, 0);

    // CRITICAL: Verify wallet was NOT altered silently
    const walletAfter = await Wallet.findOne({ userId });
    assert.strictEqual(walletAfter.availablePaisa, 99999, "Reconciliation must NEVER silently change balance!");
    assert.strictEqual(walletAfter.reconciliationMismatch, true, "Wallet must be flagged with mismatch");
  });

  // ==========================================
  // SECTION 12: AUTHORITATIVE BALANCES & READ APIS
  // ==========================================

  test("27. ledgerService.getWalletBalances returns authoritative minor units and formatted strings", async () => {
    const balances = await ledgerService.getWalletBalances("test_p4_user_credit_001");
    assert.strictEqual(balances.availablePaisa, 60000);
    assert.strictEqual(balances.availableRupees, "600.00");
    assert.strictEqual(balances.lockedPaisa, 0);
    assert.strictEqual(balances.lockedRupees, "0.00");
  });

  test("28. ledgerService.getUserStatement returns paginated statement rows", async () => {
    const statement = await ledgerService.getUserStatement("test_p4_user_credit_001");
    assert(statement.totalItems >= 2);
    assert(statement.postings.length >= 2);
    assert(statement.postings[0].amountRupees !== undefined);
  });

  // ==========================================
  // SECTION 13: REGISTRATION INITIALIZATION
  // ==========================================

  test("29. User wallet is initialized with zero balances without unconfirmed token credits", async () => {
    const testUser = await Wallet.create({
      user: new mongoose.Types.ObjectId(),
      userId: "test_p4_new_reg_user",
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    assert.strictEqual(testUser.availablePaisa, 0);
    assert.strictEqual(testUser.lockedPaisa, 0);
    assert.strictEqual(testUser.totalEarnedPaisa, 0);
    assert.strictEqual(testUser.tokenWallet, 0);
  });
});
