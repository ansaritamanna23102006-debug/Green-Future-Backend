import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import Package from "../models/Package.js";
import Withdrawal from "../models/Withdrawal.js";
import Settings from "../models/Settings.js";
import GenealogyService from "./genealogyService.js";
import IncomeService from "./incomeService.js";
import AppError from "../utils/errors.js";
import logger from "../config/logger.js";

class WalletService {
  /**
   * Purchases and activates a GFT package for a user.
   * Activates user node, adds volume to uplines, awards GFT tokens, and triggers sponsor commission.
   */
  async purchasePackage(userId, packageId) {
    try {
      const user = await User.findOne({ userId });
      if (!user) throw new AppError("User not found", 404);

      const pkg = await Package.findById(packageId);
      if (!pkg || pkg.status !== "active") {
        throw new AppError("Selected package is not active or does not exist", 400);
      }

      // Check wallet balance
      const wallet = await Wallet.findOne({ userId });
      if (!wallet || wallet.incomeWallet < pkg.price) {
        throw new AppError(`Insufficient wallet balance. Package price is ₹${pkg.price}, but your balance is ₹${wallet ? wallet.incomeWallet : 0}`, 400);
      }

      // Deduct from wallet
      wallet.incomeWallet -= pkg.price;
      wallet.tokenWallet += pkg.tokenRewardAmount;
      await wallet.save();

      // Log Package Purchase Transaction
      await Transaction.create({
        user: user._id,
        userId: user.userId,
        amount: pkg.price,
        currency: "INR",
        type: "debit",
        category: "package_purchase",
        description: `Purchased Eco package: ${pkg.name}`,
        referenceId: pkg._id.toString(),
      });

      // Log Token Reward Transaction
      await Transaction.create({
        user: user._id,
        userId: user.userId,
        amount: pkg.tokenRewardAmount,
        currency: "GFT",
        type: "credit",
        category: "registration_bonus",
        description: `Staking Token Reward from purchasing package: ${pkg.name}`,
        referenceId: pkg._id.toString(),
      });

      // Activate User Profile
      user.status = "active";
      user.activePackage = {
        packageId: pkg._id,
        name: pkg.name,
        amount: pkg.price,
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year validity
      };
      await user.save();

      // Add Sales Volume to upline leg accumulators
      await GenealogyService.addSalesVolume(user.userId, pkg.price);

      // Trigger 10% Direct Referral Commission to sponsor
      await IncomeService.payDirectIncome(user.userId, pkg.price);

      logger.info(`User ${user.userId} purchased package ${pkg.name} successfully`);
      return { user, wallet };
    } catch (error) {
      logger.error(`Package Purchase Error for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transfers GFT tokens from one user's token wallet to another's.
   */
  async transferTokens(senderUserId, receiverUserId, amount) {
    try {
      if (amount <= 0) throw new AppError("Transfer amount must be positive", 400);
      if (senderUserId === receiverUserId) throw new AppError("Cannot transfer tokens to yourself", 400);

      const sender = await User.findOne({ userId: senderUserId });
      const receiver = await User.findOne({ userId: receiverUserId });
      if (!sender || !receiver) throw new AppError("Sender or Receiver user not found", 404);

      const senderWallet = await Wallet.findOne({ userId: senderUserId });
      if (!senderWallet || senderWallet.tokenWallet < amount) {
        throw new AppError("Insufficient GFT token balance", 400);
      }

      const receiverWallet = await Wallet.findOne({ userId: receiverUserId });

      // Process transfer
      senderWallet.tokenWallet -= amount;
      await senderWallet.save();

      receiverWallet.tokenWallet += amount;
      await receiverWallet.save();

      // Log transactions
      await Transaction.create({
        user: sender._id,
        userId: senderUserId,
        amount: amount,
        currency: "GFT",
        type: "debit",
        category: "transfer",
        description: `Transferred GFT tokens to user ${receiverUserId}`,
        referenceId: receiverUserId,
      });

      await Transaction.create({
        user: receiver._id,
        userId: receiverUserId,
        amount: amount,
        currency: "GFT",
        type: "credit",
        category: "transfer",
        description: `Received GFT tokens from user ${senderUserId}`,
        referenceId: senderUserId,
      });

      logger.info(`Transferred ${amount} GFT from ${senderUserId} to ${receiverUserId}`);
      return { senderWallet, receiverWallet };
    } catch (error) {
      logger.error(`Token Transfer Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submits a withdrawal request. Holds the amount from the user's income wallet.
   */
  async requestWithdrawal(userId, amount, paymentMethod, paymentDetails) {
    try {
      const user = await User.findOne({ userId });
      if (!user) throw new AppError("User not found", 404);

      const settings = await Settings.findOne({ key: "global_settings" }) || { minWithdrawalAmount: 500, kycRequiredForWithdrawal: true };

      // KYC Validation
      if (settings.kycRequiredForWithdrawal && user.kyc.status !== "approved") {
        throw new AppError("KYC verification is required before requesting withdrawals", 400);
      }

      // Min amount validation
      if (amount < settings.minWithdrawalAmount) {
        throw new AppError(`Minimum withdrawal amount is ₹${settings.minWithdrawalAmount}`, 400);
      }

      const wallet = await Wallet.findOne({ userId });
      if (!wallet || wallet.incomeWallet < amount) {
        throw new AppError("Insufficient balance in income wallet", 400);
      }

      // Deduct from income wallet (Hold funds)
      wallet.incomeWallet -= amount;
      await wallet.save();

      // Create pending withdrawal request
      const withdrawal = await Withdrawal.create({
        user: user._id,
        userId,
        amount,
        paymentMethod,
        details: paymentDetails,
      });

      logger.info(`Withdrawal request of ₹${amount} submitted by user ${userId}`);
      return withdrawal;
    } catch (error) {
      logger.error(`Withdrawal Request Error for ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Approves a withdrawal request.
   */
  async approveWithdrawal(withdrawalId, txHash = "") {
    try {
      const withdrawal = await Withdrawal.findById(withdrawalId);
      if (!withdrawal || withdrawal.status !== "pending") {
        throw new AppError("Withdrawal request not found or not in pending state", 404);
      }

      withdrawal.status = "approved";
      withdrawal.txHash = txHash;
      withdrawal.processedAt = new Date();
      await withdrawal.save();

      const wallet = await Wallet.findOne({ userId: withdrawal.userId });
      if (wallet) {
        wallet.withdrawalWallet += withdrawal.amount;
        await wallet.save();
      }

      // Log Transaction
      await Transaction.create({
        user: withdrawal.user,
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        currency: withdrawal.paymentMethod === "USDT_WALLET" ? "USDT" : "INR",
        type: "debit",
        category: "withdrawal",
        description: `Approved withdrawal processed via ${withdrawal.paymentMethod}`,
        referenceId: withdrawal._id.toString(),
        status: "completed",
      });

      logger.info(`Approved and processed withdrawal ID ${withdrawalId}`);
      return withdrawal;
    } catch (error) {
      logger.error(`Withdrawal Approval Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Rejects a withdrawal request. Refunds the held amount back to the user's income wallet.
   */
  async rejectWithdrawal(withdrawalId, rejectReason) {
    try {
      const withdrawal = await Withdrawal.findById(withdrawalId);
      if (!withdrawal || withdrawal.status !== "pending") {
        throw new AppError("Withdrawal request not found or not in pending state", 404);
      }

      withdrawal.status = "rejected";
      withdrawal.rejectReason = rejectReason;
      withdrawal.processedAt = new Date();
      await withdrawal.save();

      // Refund income wallet
      const wallet = await Wallet.findOne({ userId: withdrawal.userId });
      if (wallet) {
        wallet.incomeWallet += withdrawal.amount;
        await wallet.save();
      }

      // Log Transaction
      await Transaction.create({
        user: withdrawal.user,
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        currency: "INR",
        type: "credit",
        category: "withdrawal",
        description: `Rejected withdrawal request refunded. Reason: ${rejectReason}`,
        referenceId: withdrawal._id.toString(),
        status: "failed",
      });

      logger.info(`Rejected withdrawal ID ${withdrawalId}. Refunded ₹${withdrawal.amount} to user ${withdrawal.userId}`);
      return withdrawal;
    } catch (error) {
      logger.error(`Withdrawal Rejection Error: ${error.message}`);
      throw error;
    }
  }
}

export default new WalletService();
