import mongoose from "mongoose";
import JournalEntry from "../models/JournalEntry.js";
import LedgerPosting from "../models/LedgerPosting.js";
import Wallet from "../models/Wallet.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import logger from "../config/logger.js";
import { formatPaisaToRupees } from "../utils/money.js";
import {
  JOURNAL_STATUS,
  POSTING_DIRECTION,
  ACCOUNT_TYPES,
  JOURNAL_EVENT_TYPES,
  SUPPORTED_LEDGER_CURRENCIES,
} from "../utils/rules/ledgerConstants.js";

class LedgerService {
  /**
   * Authoritative method to record a double-entry financial journal.
   * 
   * Strict Guarantees:
   * - Deterministic Idempotency
   * - Mathematical Balance: Sum(Debits) === Sum(Credits)
   * - Atomic Single-Document Balance Projection Updates
   * - Non-Negative Balance Protection via { availablePaisa: { $gte: debitAmount } }
   * - Compensating status marking on failure (No silent data alterations)
   * 
   * @param {Object} params
   * @param {string} params.idempotencyKey - Unique idempotency identifier
   * @param {string} params.referenceId - Authoritative business reference (e.g. orderId)
   * @param {string} params.eventType - JOURNAL_EVENT_TYPES enum value
   * @param {string} params.description - Human-readable narrative description
   * @param {Array<Object>} params.postings - Array of double-entry postings
   * @param {Object} [params.metadata] - Optional audit metadata
   * @returns {Promise<{ isReplay: boolean, journal: Object, postings: Array<Object> }>}
   */
  async recordJournalEntry({
    idempotencyKey,
    referenceId,
    eventType,
    description,
    postings,
    metadata = {},
  }) {
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      throw new AppError("A valid, non-empty idempotencyKey is required for ledger operations.", 400);
    }
    if (!referenceId || typeof referenceId !== "string" || !referenceId.trim()) {
      throw new AppError("A valid referenceId is required for ledger operations.", 400);
    }
    if (!Object.values(JOURNAL_EVENT_TYPES).includes(eventType)) {
      throw new AppError(`Invalid journal eventType: '${eventType}'.`, 400);
    }
    if (!Array.isArray(postings) || postings.length < 2) {
      throw new AppError("A double-entry journal requires at least two postings.", 400);
    }

    // 1. Idempotency Check
    const existingJournal = await JournalEntry.findOne({ idempotencyKey: idempotencyKey.trim() });
    if (existingJournal) {
      if (existingJournal.status === JOURNAL_STATUS.COMMITTED) {
        const existingPostings = await LedgerPosting.find({ journalId: existingJournal._id });
        await AuditLog.create({
          userId: metadata.userId || "SYSTEM",
          action: "LEDGER_IDEMPOTENCY_REPLAY",
          details: `Idempotent replay detected for idempotencyKey: ${idempotencyKey}`,
        });
        return {
          isReplay: true,
          journal: existingJournal,
          postings: existingPostings,
        };
      } else if (existingJournal.status === JOURNAL_STATUS.REJECTED_INSUFFICIENT_FUNDS) {
        throw new AppError("Operation previously rejected due to insufficient funds (idempotent failure).", 400);
      } else if (existingJournal.status === JOURNAL_STATUS.PENDING) {
        throw new AppError("Transaction is currently processing. Please retry shortly.", 409);
      } else {
        throw new AppError(`Operation previously failed with status: ${existingJournal.status}.`, 400);
      }
    }

    // 2. Conflicting Reference Check (same referenceId with a different idempotencyKey)
    const conflictingRef = await JournalEntry.findOne({
      referenceId: referenceId.trim(),
      eventType,
    });
    if (conflictingRef && conflictingRef.idempotencyKey !== idempotencyKey.trim()) {
      throw new AppError(
        `Conflicting idempotency key for reference '${referenceId}' with event '${eventType}'.`,
        409
      );
    }

    // 3. Postings Validation & Mathematical Balance Invariant Check
    let totalDebits = 0;
    let totalCredits = 0;
    const baseCurrency = postings[0].currency || "INR";

    if (!SUPPORTED_LEDGER_CURRENCIES.includes(baseCurrency)) {
      throw new AppError(`Unsupported ledger currency: '${baseCurrency}'.`, 400);
    }

    for (const p of postings) {
      if (!p.accountId || typeof p.accountId !== "string") {
        throw new AppError("Every posting must have a valid accountId string.", 400);
      }
      if (p.currency !== baseCurrency) {
        throw new AppError(
          `Mixed currencies within a single journal entry are prohibited. Found '${p.currency}' vs '${baseCurrency}'.`,
          400
        );
      }
      if (!Number.isSafeInteger(p.amountPaisa) || p.amountPaisa <= 0) {
        throw new AppError(
          `Posting amountPaisa must be a positive safe integer (> 0). Received: ${p.amountPaisa}`,
          400
        );
      }
      if (!Object.values(POSTING_DIRECTION).includes(p.direction)) {
        throw new AppError(`Invalid posting direction: '${p.direction}'. Must be DEBIT or CREDIT.`, 400);
      }

      if (p.direction === POSTING_DIRECTION.DEBIT) {
        totalDebits += p.amountPaisa;
      } else {
        totalCredits += p.amountPaisa;
      }
    }

    if (totalDebits !== totalCredits) {
      throw new AppError(
        `Unbalanced double-entry journal: Total debits (${totalDebits}) must equal total credits (${totalCredits}).`,
        400
      );
    }

    // Step 1: Create JournalEntry in PENDING state
    let journal;
    try {
      journal = await JournalEntry.create({
        idempotencyKey: idempotencyKey.trim(),
        referenceId: referenceId.trim(),
        eventType,
        description,
        status: JOURNAL_STATUS.PENDING,
        metadata,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Race condition: another thread created the journal with this idempotency key
        const recheck = await JournalEntry.findOne({ idempotencyKey: idempotencyKey.trim() });
        if (recheck && recheck.status === JOURNAL_STATUS.COMMITTED) {
          const recPostings = await LedgerPosting.find({ journalId: recheck._id });
          return { isReplay: true, journal: recheck, postings: recPostings };
        }
        throw new AppError("Concurrent duplicate idempotency key detected.", 409);
      }
      throw err;
    }

    // Step 2: Insert Postings in a single atomic batch
    let createdPostings;
    try {
      const postingsToInsert = postings.map((p) => ({
        journalId: journal._id,
        accountId: p.accountId.trim(),
        userId: p.userId ? p.userId.trim() : "",
        walletType: p.walletType || "AVAILABLE_INCOME",
        currency: p.currency,
        amountPaisa: p.amountPaisa,
        direction: p.direction,
      }));

      createdPostings = await LedgerPosting.insertMany(postingsToInsert);
    } catch (err) {
      logger.error(`Failed to insert ledger postings for journal ${journal._id}: ${err.message}`);
      await JournalEntry.updateOne(
        { _id: journal._id, status: JOURNAL_STATUS.PENDING },
        { $set: { status: JOURNAL_STATUS.FAILED, "metadata.failureReason": err.message } }
      );
      throw new AppError(`Failed to persist ledger postings: ${err.message}`, 500);
    }

    // Step 3: Apply Atomic Balance Projections to User Wallets
    // Find postings that affect User Available Balance
    const userWalletUpdates = postings.filter(
      (p) => p.userId && (p.walletType === "AVAILABLE_INCOME" || p.accountId.includes("AVAILABLE_INCOME"))
    );

    for (const update of userWalletUpdates) {
      const { userId, amountPaisa, direction } = update;

      // Ensure user has a wallet document initialized
      await Wallet.findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            user: new mongoose.Types.ObjectId(),
            userId,
            availablePaisa: 0,
            lockedPaisa: 0,
            totalEarnedPaisa: 0,
            version: 1,
          },
        },
        { upsert: true, new: true }
      );

      if (direction === POSTING_DIRECTION.DEBIT) {
        // Atomic Debit Guard: availablePaisa must be >= debit amount
        const updatedWallet = await Wallet.findOneAndUpdate(
          {
            userId,
            availablePaisa: { $gte: amountPaisa },
          },
          {
            $inc: {
              availablePaisa: -amountPaisa,
              version: 1,
            },
          },
          { new: true }
        );

        if (!updatedWallet) {
          // Insufficient funds! Mark journal as REJECTED_INSUFFICIENT_FUNDS
          await JournalEntry.updateOne(
            { _id: journal._id, status: JOURNAL_STATUS.PENDING },
            {
              $set: {
                status: JOURNAL_STATUS.REJECTED_INSUFFICIENT_FUNDS,
                "metadata.rejectionReason": `User ${userId} has insufficient available funds for debit of ${amountPaisa} paisa.`,
              },
            }
          );

          await AuditLog.create({
            userId,
            action: "LEDGER_DEBIT_FAILED_INSUFFICIENT_FUNDS",
            details: `Debit of ${amountPaisa} paisa failed due to insufficient balance. Journal ${journal._id} marked REJECTED_INSUFFICIENT_FUNDS.`,
          });

          throw new AppError(
            `Insufficient available balance. Required: ₹${formatPaisaToRupees(amountPaisa)}.`,
            400
          );
        }
      } else if (direction === POSTING_DIRECTION.CREDIT) {
        // Atomic Credit
        await Wallet.findOneAndUpdate(
          { userId },
          {
            $inc: {
              availablePaisa: amountPaisa,
              totalEarnedPaisa: amountPaisa,
              version: 1,
            },
          }
        );
      }
    }

    // Step 4: Commit the JournalEntry
    await JournalEntry.updateOne(
      { _id: journal._id, status: JOURNAL_STATUS.PENDING },
      { $set: { status: JOURNAL_STATUS.COMMITTED } }
    );

    journal.status = JOURNAL_STATUS.COMMITTED;

    // Step 5: Audit Log
    try {
      await AuditLog.create({
        userId: metadata.userId || "SYSTEM",
        action: "LEDGER_JOURNAL_COMMITTED",
        details: `Committed journal ${journal._id} for ref ${referenceId} (${eventType}). Amount: ${totalDebits} paisa.`,
      });
    } catch (auditErr) {
      logger.warn(`AuditLog non-fatal error: ${auditErr.message}`);
    }

    return {
      isReplay: false,
      journal,
      postings: createdPostings,
    };
  }

  /**
   * Authoritative read of user wallet balances.
   * Resolves integer minor units and provides formatted display values.
   */
  async getWalletBalances(userId) {
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = await Wallet.create({
        user: new mongoose.Types.ObjectId(),
        userId,
        availablePaisa: 0,
        lockedPaisa: 0,
        totalEarnedPaisa: 0,
        version: 1,
      });
    }

    const availablePaisa = wallet.availablePaisa || 0;
    const lockedPaisa = wallet.lockedPaisa || 0;
    const totalEarnedPaisa = wallet.totalEarnedPaisa || 0;

    return {
      userId: wallet.userId,
      availablePaisa,
      lockedPaisa,
      totalEarnedPaisa,
      version: wallet.version || 1,
      reconciliationMismatch: !!wallet.reconciliationMismatch,
      // Formatted representations for frontend display
      availableRupees: formatPaisaToRupees(availablePaisa),
      lockedRupees: formatPaisaToRupees(lockedPaisa),
      totalEarnedRupees: formatPaisaToRupees(totalEarnedPaisa),
      // Legacy compatibility values
      incomeWallet: availablePaisa / 100,
      tokenWallet: wallet.tokenWallet || 0,
      withdrawalWallet: wallet.withdrawalWallet || 0,
      totalEarned: totalEarnedPaisa / 100,
    };
  }

  /**
   * Fetch paginated ledger statement history for a user.
   */
  async getUserStatement(userId, options = {}) {
    const page = Math.max(1, parseInt(options.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(options.limit || "20", 10)));
    const skip = (page - 1) * limit;

    const query = { userId };
    if (options.currency) query.currency = options.currency;

    const [postings, total] = await Promise.all([
      LedgerPosting.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("journalId", "referenceId eventType description status createdAt"),
      LedgerPosting.countDocuments(query),
    ]);

    const formattedPostings = postings.map((p) => ({
      _id: p._id,
      journalId: p.journalId?._id,
      referenceId: p.journalId?.referenceId || "",
      eventType: p.journalId?.eventType || "",
      description: p.journalId?.description || "",
      amountPaisa: p.amountPaisa,
      amountRupees: formatPaisaToRupees(p.amountPaisa),
      currency: p.currency,
      direction: p.direction,
      walletType: p.walletType,
      createdAt: p.createdAt,
    }));

    return {
      postings: formattedPostings,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
    };
  }
}

export default new LedgerService();
