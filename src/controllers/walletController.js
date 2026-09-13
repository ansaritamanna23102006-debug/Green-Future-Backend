import WalletService from "../services/walletService.js";
import ledgerService from "../services/ledgerService.js";
import Transaction from "../models/Transaction.js";
import Withdrawal from "../models/Withdrawal.js";
import Package from "../models/Package.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

/**
 * Authoritative Wallet Balances
 * Returns integer minor units (paisa) and formatted INR display strings.
 */
export const getWalletBalances = async (req, res, next) => {
  try {
    const balances = await ledgerService.getWalletBalances(req.user.userId);
    return successResponse(res, balances, "Authoritative wallet balances fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * Ledger Statement History (Phase 4 Authoritative Double-Entry History)
 */
export const getLedgerStatement = async (req, res, next) => {
  try {
    const statement = await ledgerService.getUserStatement(req.user.userId, req.query);
    return successResponse(res, statement, "Ledger statement fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy Transaction History (Read-Only Historical Lookup)
 */
export const getTransactionHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "10", 10);
    const skip = (page - 1) * limit;

    const query = { userId: req.user.userId };
    if (req.query.currency) query.currency = req.query.currency;
    if (req.query.category) query.category = req.query.category;
    if (req.query.type) query.type = req.query.type;

    const count = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(
      res,
      {
        transactions,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
      },
      "Historical transaction records fetched successfully"
    );
  } catch (error) {
    next(error);
  }
};

export const buyPackage = async (req, res, next) => {
  try {
    throw new AppError(
      "The legacy direct package purchase endpoint has been deprecated for security and compliance. Please use the authoritative order lifecycle via POST /api/v1/orders.",
      410
    );
  } catch (error) {
    next(error);
  }
};

export const transferTokens = async (req, res, next) => {
  try {
    const { receiverUserId, amount } = req.body;
    const result = await WalletService.transferTokens(
      req.user.userId,
      receiverUserId,
      amount
    );
    return successResponse(res, result, "Transfer successful");
  } catch (error) {
    next(error);
  }
};

export const requestWithdrawal = async (req, res, next) => {
  try {
    const { amount, paymentMethod, paymentDetails } = req.body;
    const result = await WalletService.requestWithdrawal(
      req.user.userId,
      amount,
      paymentMethod,
      paymentDetails
    );
    return successResponse(res, result, "Withdrawal submitted");
  } catch (error) {
    next(error);
  }
};

export const getWithdrawalHistory = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    return successResponse(res, withdrawals, "Withdrawal history fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getPackages = async (req, res, next) => {
  try {
    const packages = await Package.find({ status: "active" });
    return successResponse(res, packages, "Packages fetched successfully");
  } catch (error) {
    next(error);
  }
};
