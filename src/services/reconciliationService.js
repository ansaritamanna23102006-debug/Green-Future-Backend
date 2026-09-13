import JournalEntry from "../models/JournalEntry.js";
import LedgerPosting from "../models/LedgerPosting.js";
import Wallet from "../models/Wallet.js";
import AuditLog from "../models/AuditLog.js";
import logger from "../config/logger.js";
import { JOURNAL_STATUS, POSTING_DIRECTION } from "../utils/rules/ledgerConstants.js";
import { formatPaisaToRupees } from "../utils/money.js";

class ReconciliationService {
  /**
   * Mathematically reconcile a user's wallet projection against immutable committed ledger postings.
   * 
   * Strict Rule:
   * Reconciliation is an investigative detection tool.
   * It NEVER silently alters, manufactures, or destroys money.
   * 
   * @param {string} userId - Target user ID
   * @param {string} [currency="INR"] - Currency to reconcile
   * @returns {Promise<Object>} Reconciliation report
   */
  async reconcileUser(userId, currency = "INR") {
    if (!userId) throw new Error("userId is required for reconciliation.");

    // Fetch all postings for this user and currency, populating the journal document
    const postings = await LedgerPosting.find({ userId, currency }).populate("journalId");

    let totalCreditsPaisa = 0;
    let totalDebitsPaisa = 0;

    for (const p of postings) {
      const journalStatus = p.journalId ? p.journalId.status : null;
      if (journalStatus === JOURNAL_STATUS.COMMITTED) {
        if (p.direction === POSTING_DIRECTION.CREDIT) {
          totalCreditsPaisa += p.amountPaisa;
        } else if (p.direction === POSTING_DIRECTION.DEBIT) {
          totalDebitsPaisa += p.amountPaisa;
        }
      }
    }

    const calculatedLedgerSumPaisa = totalCreditsPaisa - totalDebitsPaisa;

    // Fetch current Wallet projection
    const wallet = await Wallet.findOne({ userId });
    const currentAvailablePaisa = wallet ? wallet.availablePaisa || 0 : 0;
    const currentLockedPaisa = wallet ? wallet.lockedPaisa || 0 : 0;
    const currentProjectionTotalPaisa = currentAvailablePaisa + currentLockedPaisa;

    const discrepancyPaisa = currentProjectionTotalPaisa - calculatedLedgerSumPaisa;

    if (discrepancyPaisa === 0) {
      if (wallet && wallet.reconciliationMismatch) {
        await Wallet.updateOne({ userId }, { $set: { reconciliationMismatch: false } });
      }

      await AuditLog.create({
        userId,
        action: "LEDGER_RECONCILIATION_SUCCESS",
        details: `Reconciliation verified BALANCED for user ${userId}. Ledger sum: ${calculatedLedgerSumPaisa} paisa (₹${formatPaisaToRupees(calculatedLedgerSumPaisa)}).`,
      });

      return {
        status: "BALANCED",
        userId,
        currency,
        calculatedLedgerSumPaisa,
        calculatedLedgerSumRupees: formatPaisaToRupees(calculatedLedgerSumPaisa),
        walletProjectionPaisa: currentProjectionTotalPaisa,
        walletProjectionRupees: formatPaisaToRupees(currentProjectionTotalPaisa),
        discrepancyPaisa: 0,
        discrepancyRupees: "0.00",
        timestamp: new Date().toISOString(),
      };
    } else {
      // Discrepancy detected! Flag wallet and log high-severity audit event
      if (wallet) {
        await Wallet.updateOne({ userId }, { $set: { reconciliationMismatch: true } });
      }

      await AuditLog.create({
        userId,
        action: "LEDGER_RECONCILIATION_MISMATCH",
        details: `DISCREPANCY DETECTED for user ${userId}. Projection (${currentProjectionTotalPaisa} paisa) != Ledger (${calculatedLedgerSumPaisa} paisa). Delta: ${discrepancyPaisa} paisa. Zero funds were modified.`,
      });

      logger.warn(
        `[RECONCILIATION MISMATCH] User ${userId}: Projection = ${currentProjectionTotalPaisa} paisa, Ledger = ${calculatedLedgerSumPaisa} paisa. Delta = ${discrepancyPaisa} paisa.`
      );

      return {
        status: "DISCREPANCY_DETECTED",
        userId,
        currency,
        calculatedLedgerSumPaisa,
        calculatedLedgerSumRupees: formatPaisaToRupees(calculatedLedgerSumPaisa),
        walletProjectionPaisa: currentProjectionTotalPaisa,
        walletProjectionRupees: formatPaisaToRupees(currentProjectionTotalPaisa),
        discrepancyPaisa,
        discrepancyRupees: formatPaisaToRupees(discrepancyPaisa),
        timestamp: new Date().toISOString(),
        warning: "Zero balances were altered. Mismatch flagged for Super Admin audit.",
      };
    }
  }

  /**
   * Diagnostic scan for orphaned or pending journals (crash window recovery inspection).
   */
  async scanStaleJournals(olderThanMinutes = 5) {
    const thresholdDate = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const staleJournals = await JournalEntry.find({
      status: JOURNAL_STATUS.PENDING,
      createdAt: { $lte: thresholdDate },
    });

    return staleJournals.map((j) => ({
      _id: j._id,
      idempotencyKey: j.idempotencyKey,
      referenceId: j.referenceId,
      eventType: j.eventType,
      status: j.status,
      createdAt: j.createdAt,
    }));
  }
}

export default new ReconciliationService();
