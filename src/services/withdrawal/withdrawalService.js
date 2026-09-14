import mongoose from "mongoose";
import Withdrawal from "../../models/Withdrawal.js";
import Wallet from "../../models/Wallet.js";
import User from "../../models/User.js";
import AuditLog from "../../models/AuditLog.js";
import ledgerService from "../ledgerService.js";
import payoutProvider from "./payoutProvider.js";
import AppError from "../../utils/errors.js";
import logger from "../../config/logger.js";
import {
  WITHDRAWAL_STATUS,
  ALLOWED_STATE_TRANSITIONS,
  DESTINATION_TYPES,
  WITHDRAWAL_AUDIT_ACTIONS,
} from "./withdrawalConstants.js";
import {
  ACCOUNT_TYPES,
  POSTING_DIRECTION,
  JOURNAL_EVENT_TYPES,
} from "../../utils/rules/ledgerConstants.js";
import {
  BUSINESS_PLAN_STATUS,
  WITHDRAWAL_CONFIG,
  RULE_STATUS,
} from "../../utils/rules/businessPlanConfig.js";

class WithdrawalService {
  /**
   * Helper: Resolve withdrawal business rules and assert executability.
   * If custom config override is provided (e.g. controlled test fixture), use it.
   */
  resolveWithdrawalConfig(customConfig = null) {
    if (customConfig) {
      return customConfig;
    }

    // Authoritative check against Phase 0 business plan config
    const globalConfirmed = BUSINESS_PLAN_STATUS === RULE_STATUS.CONFIRMED;
    const minINRConfirmed =
      WITHDRAWAL_CONFIG.minWithdrawalINR &&
      WITHDRAWAL_CONFIG.minWithdrawalINR.confirmationStatus === RULE_STATUS.CONFIRMED;
    const feeConfirmed =
      WITHDRAWAL_CONFIG.processingFeePercentage &&
      WITHDRAWAL_CONFIG.processingFeePercentage.confirmationStatus === RULE_STATUS.CONFIRMED;

    const isExecutable = globalConfirmed && minINRConfirmed && feeConfirmed;

    return {
      isExecutable,
      minWithdrawalINR: WITHDRAWAL_CONFIG.minWithdrawalINR?.value || 500,
      processingFeePercentage: WITHDRAWAL_CONFIG.processingFeePercentage?.value || 5.0,
      ruleVersion: isExecutable ? "CONFIRMED_V1" : "BUSINESS_PLAN_DRAFT_V0",
      reason: !isExecutable
        ? "Withdrawal rules require authoritative client confirmation. Live execution is BLOCKED."
        : null,
    };
  }

  /**
   * Calculate deterministic server-side fee in Paisa.
   */
  calculateFeePaisa(amountPaisa, feePercentage) {
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) {
      throw new AppError("Invalid amount for fee calculation.", 400);
    }
    // Deterministic integer rounding
    const feePaisa = Math.round((amountPaisa * feePercentage) / 100);
    const netAmountPaisa = amountPaisa - feePaisa;
    if (netAmountPaisa <= 0) {
      throw new AppError("Net withdrawal amount must be greater than zero.", 400);
    }
    return { feePaisa, netAmountPaisa };
  }

  /**
   * 1. Member creates a withdrawal request.
   * Enforces:
   * - KYC verification (Service-level Gate: user.kyc.status === "APPROVED")
   * - Business rule execution gate
   * - Input validation (exact integer Paisa, positive, min threshold, destination)
   * - Double-entry ledger hold reservation (debiting USER:AVAILABLE, crediting SYSTEM:WITHDRAWAL_HOLD)
   * - Deterministic Idempotency
   */
  async requestWithdrawal({
    userId,
    amountPaisa,
    destinationType,
    destinationReference,
    idempotencyKey,
    testRuleOverride = null,
  }) {
    if (!userId) throw new AppError("userId is required.", 400);
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      throw new AppError("idempotencyKey is required.", 400);
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    // Check for existing withdrawal by idempotencyKey
    const existingWithdrawal = await Withdrawal.findOne({ idempotencyKey: cleanIdempotencyKey });
    if (existingWithdrawal) {
      return {
        isReplay: true,
        withdrawal: existingWithdrawal,
      };
    }

    // KYC SERVICE-LEVEL GATE: independently verify kyc.status === "APPROVED"
    const user = await User.findOne({ userId });
    if (!user) {
      throw new AppError(`User ${userId} not found.`, 404);
    }

    const userKycStatus = user.kyc ? String(user.kyc.status).toUpperCase() : "NOT_STARTED";
    if (userKycStatus !== "APPROVED") {
      await AuditLog.create({
        userId,
        action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_BLOCKED,
        details: `Withdrawal request blocked: KYC status is ${userKycStatus} (APPROVED required).`,
      });
      throw new AppError(
        `Withdrawal blocked: KYC verification required. Current status: ${userKycStatus}.`,
        403
      );
    }

    // Validate destination
    if (!destinationType || !Object.values(DESTINATION_TYPES).includes(destinationType)) {
      throw new AppError(
        `Invalid destinationType. Allowed: ${Object.values(DESTINATION_TYPES).join(", ")}.`,
        400
      );
    }
    if (!destinationReference || typeof destinationReference !== "string" || !destinationReference.trim()) {
      throw new AppError("destinationReference is required.", 400);
    }
    const cleanDestinationRef = destinationReference.trim();

    // Validate amount
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) {
      throw new AppError("Withdrawal amount must be a positive integer in Paisa.", 400);
    }

    // Resolve Business Rules & Gate
    const ruleConfig = this.resolveWithdrawalConfig(testRuleOverride);
    if (!ruleConfig.isExecutable) {
      await AuditLog.create({
        userId,
        action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_BLOCKED,
        details: `Withdrawal request blocked by business rule gate: ${ruleConfig.reason}`,
      });
      throw new AppError(
        `Withdrawal blocked: ${ruleConfig.reason}`,
        403
      );
    }

    // Validate minimum withdrawal threshold
    const minPaisa = (ruleConfig.minWithdrawalINR || 500) * 100;
    if (amountPaisa < minPaisa) {
      throw new AppError(
        `Withdrawal amount must be at least ₹${ruleConfig.minWithdrawalINR} (${minPaisa} paisa).`,
        400
      );
    }

    // Check available balance before ledger submission
    const wallet = await Wallet.findOne({ userId });
    const availablePaisa = wallet ? wallet.availablePaisa || 0 : 0;
    if (availablePaisa < amountPaisa) {
      throw new AppError(
        `Insufficient available balance. Available: ${availablePaisa} paisa, Requested: ${amountPaisa} paisa.`,
        400
      );
    }

    // Deterministic fee calculation
    const { feePaisa, netAmountPaisa } = this.calculateFeePaisa(
      amountPaisa,
      ruleConfig.processingFeePercentage
    );

    const referenceId = `WITHDRAWAL:${cleanIdempotencyKey}`;

    // Record double-entry reservation:
    // Debit: USER:<userId>:AVAILABLE_INCOME (amountPaisa)
    // Credit: SYSTEM:WITHDRAWAL_HOLD (amountPaisa)
    const holdPostings = [
      {
        accountId: `USER:${userId}:AVAILABLE_INCOME`,
        userId,
        walletType: "AVAILABLE_INCOME",
        currency: "INR",
        amountPaisa,
        direction: POSTING_DIRECTION.DEBIT,
      },
      {
        accountId: "SYSTEM:WITHDRAWAL_HOLD",
        userId: "",
        walletType: ACCOUNT_TYPES.SYSTEM_WITHDRAWAL_HOLD,
        currency: "INR",
        amountPaisa,
        direction: POSTING_DIRECTION.CREDIT,
      },
    ];

    let journalResult;
    try {
      journalResult = await ledgerService.recordJournalEntry({
        referenceId,
        eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_HOLD,
        idempotencyKey: `LEDGER:${referenceId}`,
        description: `Withdrawal hold reservation for user ${userId}. Gross: ${amountPaisa} paisa.`,
        postings: holdPostings,
        metadata: {
          userId,
          amountPaisa,
          feePaisa,
          netAmountPaisa,
          destinationType,
        },
      });
    } catch (err) {
      logger.error(`Withdrawal reservation journal failed for ${userId}: ${err.message}`);
      throw err;
    }

    // Create the immutable Withdrawal document
    let withdrawal;
    try {
      withdrawal = await Withdrawal.create({
        userId,
        user: user._id,
        amountPaisa,
        feePaisa,
        netAmountPaisa,
        currency: "INR",
        destinationType,
        destinationReference: cleanDestinationRef,
        status: WITHDRAWAL_STATUS.REQUESTED,
        idempotencyKey: cleanIdempotencyKey,
        referenceId,
        holdJournalId: journalResult.journal._id,
        ruleVersion: ruleConfig.ruleVersion,
        calculationSnapshot: {
          grossAmountPaisa: amountPaisa,
          feePercentage: ruleConfig.processingFeePercentage,
          feePaisa,
          netAmountPaisa,
          currency: "INR",
        },
        requestedAt: new Date(),
      });
    } catch (createErr) {
      if (createErr.code === 11000) {
        const raceWithdrawal = await Withdrawal.findOne({ idempotencyKey: cleanIdempotencyKey });
        if (raceWithdrawal) {
          return { isReplay: true, withdrawal: raceWithdrawal };
        }
      }
      throw createErr;
    }

    await AuditLog.create({
      userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REQUESTED,
      details: `Withdrawal requested: ID ${withdrawal._id}. Gross: ${amountPaisa} paisa, Net: ${netAmountPaisa} paisa, Fee: ${feePaisa} paisa.`,
    });

    return {
      isReplay: false,
      withdrawal,
    };
  }

  /**
   * Helper: Validate and apply state transition
   */
  assertValidTransition(currentStatus, targetStatus) {
    const allowed = ALLOWED_STATE_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        `Invalid withdrawal state transition from ${currentStatus} to ${targetStatus}.`,
        400
      );
    }
  }

  /**
   * 2. Admin starts review of a REQUESTED withdrawal.
   * State Transition: REQUESTED -> UNDER_REVIEW
   */
  async startReview({ withdrawalId, adminUserId }) {
    if (!withdrawalId) throw new AppError("withdrawalId is required.", 400);
    if (!adminUserId) throw new AppError("adminUserId is required.", 400);

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.UNDER_REVIEW);

    withdrawal.status = WITHDRAWAL_STATUS.UNDER_REVIEW;
    withdrawal.reviewedAt = new Date();
    withdrawal.reviewedBy = adminUserId;
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REVIEW_STARTED,
      details: `Withdrawal ${withdrawal._id} review started by admin ${adminUserId}.`,
    });

    return withdrawal;
  }

  /**
   * 3. Admin approves a withdrawal.
   * State Transition: UNDER_REVIEW -> APPROVED
   * Note: REQUESTED -> APPROVED is strictly rejected (requires review first).
   */
  async approveWithdrawal({ withdrawalId, adminUserId }) {
    if (!withdrawalId) throw new AppError("withdrawalId is required.", 400);
    if (!adminUserId) throw new AppError("adminUserId is required.", 400);

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.APPROVED);

    withdrawal.status = WITHDRAWAL_STATUS.APPROVED;
    withdrawal.approvedAt = new Date();
    withdrawal.approvedBy = adminUserId;
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_APPROVED,
      details: `Withdrawal ${withdrawal._id} approved by admin ${adminUserId}.`,
    });

    return withdrawal;
  }

  /**
   * 4. Admin rejects a withdrawal.
   * Allowed from: REQUESTED or UNDER_REVIEW
   * Releases the hold via compensating ledger entry:
   * Debit: SYSTEM:WITHDRAWAL_HOLD (amountPaisa)
   * Credit: USER:<userId>:AVAILABLE_INCOME (amountPaisa)
   */
  async rejectWithdrawal({ withdrawalId, adminUserId, rejectionReason }) {
    if (!withdrawalId) throw new AppError("withdrawalId is required.", 400);
    if (!adminUserId) throw new AppError("adminUserId is required.", 400);

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.REJECTED);

    // Compensating reversal entry
    const reversalPostings = [
      {
        accountId: "SYSTEM:WITHDRAWAL_HOLD",
        userId: "",
        walletType: ACCOUNT_TYPES.SYSTEM_WITHDRAWAL_HOLD,
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.DEBIT,
      },
      {
        accountId: `USER:${withdrawal.userId}:AVAILABLE_INCOME`,
        userId: withdrawal.userId,
        walletType: "AVAILABLE_INCOME",
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.CREDIT,
      },
    ];

    const reversalRef = `WITHDRAWAL_REVERSAL:${withdrawal._id}`;
    const reversalJournal = await ledgerService.recordJournalEntry({
      referenceId: reversalRef,
      eventType: JOURNAL_EVENT_TYPES.REVERSAL,
      idempotencyKey: `LEDGER:${reversalRef}`,
      description: `Hold release for rejected withdrawal ${withdrawal._id}. Reason: ${rejectionReason || "Admin rejected"}.`,
      postings: reversalPostings,
      metadata: {
        withdrawalId: withdrawal._id.toString(),
        userId: withdrawal.userId,
        rejectionReason,
      },
    });

    withdrawal.status = WITHDRAWAL_STATUS.REJECTED;
    withdrawal.rejectedAt = new Date();
    withdrawal.rejectedBy = adminUserId;
    withdrawal.rejectionReason = rejectionReason || "Rejected by administrator.";
    withdrawal.reversalJournalId = reversalJournal.journal._id;
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_REJECTED,
      details: `Withdrawal ${withdrawal._id} rejected by admin ${adminUserId}. Hold reversed. Reason: ${withdrawal.rejectionReason}`,
    });

    return withdrawal;
  }

  /**
   * 5. Process payout via payout provider.
   * State Transition: APPROVED -> PROCESSING -> COMPLETED (or FAILED)
   */
  async processPayout({ withdrawalId, customProvider = null }) {
    if (!withdrawalId) throw new AppError("withdrawalId is required.", 400);

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.PROCESSING);

    withdrawal.status = WITHDRAWAL_STATUS.PROCESSING;
    withdrawal.processingAt = new Date();
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_PROCESSING,
      details: `Withdrawal ${withdrawal._id} dispatched to payout provider.`,
    });

    const provider = customProvider || payoutProvider;
    let providerResult;
    try {
      providerResult = await provider.createPayout(withdrawal);
    } catch (providerErr) {
      logger.error(`Payout provider error for withdrawal ${withdrawal._id}: ${providerErr.message}`);
      return this.failPayout({
        withdrawalId: withdrawal._id,
        failureReason: `Provider exception: ${providerErr.message}`,
      });
    }

    if (providerResult && providerResult.success) {
      return this.completePayout({
        withdrawalId: withdrawal._id,
        providerReference: providerResult.providerReference,
      });
    } else {
      const failureReason = providerResult?.failureReason || "Payout provider rejected transaction.";
      return this.failPayout({
        withdrawalId: withdrawal._id,
        failureReason,
      });
    }
  }

  /**
   * 6. Complete payout upon successful provider execution.
   * State Transition: PROCESSING -> COMPLETED
   * Double-Entry Settlement:
   * Debit: SYSTEM:WITHDRAWAL_HOLD (amountPaisa)
   * Credit: SYSTEM:PAYMENT_CLEARING (amountPaisa)
   */
  async completePayout({ withdrawalId, providerReference }) {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.COMPLETED);

    const settlementPostings = [
      {
        accountId: "SYSTEM:WITHDRAWAL_HOLD",
        userId: "",
        walletType: ACCOUNT_TYPES.SYSTEM_WITHDRAWAL_HOLD,
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.DEBIT,
      },
      {
        accountId: "SYSTEM:PAYMENT_CLEARING",
        userId: "",
        walletType: ACCOUNT_TYPES.SYSTEM_CLEARING,
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.CREDIT,
      },
    ];

    const settlementRef = `WITHDRAWAL_SETTLED:${withdrawal._id}`;
    const settlementJournal = await ledgerService.recordJournalEntry({
      referenceId: settlementRef,
      eventType: JOURNAL_EVENT_TYPES.WITHDRAWAL_SETTLED,
      idempotencyKey: `LEDGER:${settlementRef}`,
      description: `Settlement posting for completed withdrawal ${withdrawal._id}.`,
      postings: settlementPostings,
      metadata: {
        withdrawalId: withdrawal._id.toString(),
        userId: withdrawal.userId,
        providerReference,
      },
    });

    withdrawal.status = WITHDRAWAL_STATUS.COMPLETED;
    withdrawal.completedAt = new Date();
    withdrawal.providerReference = providerReference;
    withdrawal.settlementJournalId = settlementJournal.journal._id;
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_COMPLETED,
      details: `Withdrawal ${withdrawal._id} completed. Provider ref: ${providerReference}. Settlement journal committed.`,
    });

    return withdrawal;
  }

  /**
   * 7. Fail payout upon provider failure.
   * State Transition: PROCESSING -> FAILED (or APPROVED -> FAILED)
   * Releases the hold via compensating ledger entry:
   * Debit: SYSTEM:WITHDRAWAL_HOLD (amountPaisa)
   * Credit: USER:<userId>:AVAILABLE_INCOME (amountPaisa)
   */
  async failPayout({ withdrawalId, failureReason }) {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    this.assertValidTransition(withdrawal.status, WITHDRAWAL_STATUS.FAILED);

    const reversalPostings = [
      {
        accountId: "SYSTEM:WITHDRAWAL_HOLD",
        userId: "",
        walletType: ACCOUNT_TYPES.SYSTEM_WITHDRAWAL_HOLD,
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.DEBIT,
      },
      {
        accountId: `USER:${withdrawal.userId}:AVAILABLE_INCOME`,
        userId: withdrawal.userId,
        walletType: "AVAILABLE_INCOME",
        currency: "INR",
        amountPaisa: withdrawal.amountPaisa,
        direction: POSTING_DIRECTION.CREDIT,
      },
    ];

    const failureRef = `WITHDRAWAL_FAILED_REVERSAL:${withdrawal._id}`;
    const reversalJournal = await ledgerService.recordJournalEntry({
      referenceId: failureRef,
      eventType: JOURNAL_EVENT_TYPES.REVERSAL,
      idempotencyKey: `LEDGER:${failureRef}`,
      description: `Hold release for failed withdrawal ${withdrawal._id}. Reason: ${failureReason}.`,
      postings: reversalPostings,
      metadata: {
        withdrawalId: withdrawal._id.toString(),
        userId: withdrawal.userId,
        failureReason,
      },
    });

    withdrawal.status = WITHDRAWAL_STATUS.FAILED;
    withdrawal.failedAt = new Date();
    withdrawal.failureReason = failureReason || "Payout provider failed.";
    withdrawal.reversalJournalId = reversalJournal.journal._id;
    await withdrawal.save();

    await AuditLog.create({
      userId: withdrawal.userId,
      action: WITHDRAWAL_AUDIT_ACTIONS.WITHDRAWAL_FAILED,
      details: `Withdrawal ${withdrawal._id} failed. Reason: ${withdrawal.failureReason}. Hold reversed back to user available wallet.`,
    });

    return withdrawal;
  }

  /**
   * Member: Get own withdrawals with pagination
   */
  async getUserWithdrawals(userId, { page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select("-__v"),
      Withdrawal.countDocuments({ userId }),
    ]);

    return {
      withdrawals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Admin: List withdrawals with filters
   */
  async getAdminWithdrawals({ status, userId, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.userId = userId;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select("-__v"),
      Withdrawal.countDocuments(filter),
    ]);

    return {
      withdrawals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get single withdrawal by ID (with privacy/ownership checks)
   */
  async getWithdrawalById(withdrawalId, requestingUserId, role) {
    const withdrawal = await Withdrawal.findById(withdrawalId).select("-__v");
    if (!withdrawal) throw new AppError("Withdrawal not found.", 404);

    if (role !== "admin" && role !== "superadmin" && withdrawal.userId !== requestingUserId) {
      throw new AppError("Unauthorized access to withdrawal record.", 403);
    }

    return withdrawal;
  }
}

export default new WithdrawalService();
