import AppError from "../utils/errors.js";
import logger from "../config/logger.js";
import ledgerService from "./ledgerService.js";

/**
 * WalletService (Phase 4: Financial Mutation Lockdown)
 * 
 * IMPORTANT:
 * - All direct balance-mutating methods have been DISABLED.
 * - Legacy package purchase throws HTTP 410.
 * - Token transfers are disabled pending confirmed token economics.
 * - Live withdrawal requests and processing are disabled in Phase 4.
 * - All authoritative financial reads delegate to ledgerService.
 */
class WalletService {
  /**
   * DEPRECATED: Legacy direct package purchase.
   * Packages must be purchased through the authoritative Order -> Payment -> Activation lifecycle.
   */
  async purchasePackage(userId, packageId) {
    logger.warn(`Rejected attempt to call deprecated purchasePackage for user: ${userId}`);
    throw new AppError(
      "The legacy direct package purchase endpoint has been deprecated for security and compliance. Please use the authoritative order lifecycle via POST /api/v1/orders.",
      410
    );
  }

  /**
   * DISABLED: Token transfers are disabled until token economics and precision are confirmed.
   */
  async transferTokens(senderUserId, receiverUserId, amount) {
    logger.warn(`Rejected token transfer attempt: ${senderUserId} -> ${receiverUserId}`);
    throw new AppError(
      "GFT token transfers are disabled pending confirmed token economics and precision specification.",
      403
    );
  }

  /**
   * DISABLED: Live withdrawals are disabled in Phase 4.
   */
  async requestWithdrawal(userId, amount, paymentMethod, paymentDetails) {
    logger.warn(`Rejected withdrawal request attempt for user: ${userId}`);
    throw new AppError(
      "Live withdrawals are disabled in Phase 4 pending client confirmation of withdrawal limits and rules.",
      403
    );
  }

  /**
   * DISABLED: Withdrawal approval is disabled in Phase 4.
   */
  async approveWithdrawal(withdrawalId, txHash = "") {
    logger.warn(`Rejected withdrawal approval attempt for ID: ${withdrawalId}`);
    throw new AppError(
      "Live withdrawal processing is disabled in Phase 4.",
      403
    );
  }

  /**
   * DISABLED: Withdrawal rejection is disabled in Phase 4.
   */
  async rejectWithdrawal(withdrawalId, rejectReason) {
    logger.warn(`Rejected withdrawal rejection attempt for ID: ${withdrawalId}`);
    throw new AppError(
      "Live withdrawal processing is disabled in Phase 4.",
      403
    );
  }

  /**
   * Authoritative balance read delegating to ledgerService.
   */
  async getBalances(userId) {
    return ledgerService.getWalletBalances(userId);
  }
}

export default new WalletService();
