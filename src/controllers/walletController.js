import WalletService from "../services/walletService.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import Withdrawal from "../models/Withdrawal.js";
import Package from "../models/Package.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

export const getWalletBalances = async (req, res, next) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user.userId });
    if (!wallet) {
      wallet = await Wallet.create({
        user: req.user._id,
        userId: req.user.userId,
      });
    }
    return successResponse(res, wallet, "Wallet balances fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getTransactionHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "10");
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
      "Transaction history fetched successfully"
    );
  } catch (error) {
    next(error);
  }
};

export const buyPackage = async (req, res, next) => {
  try {
    const { packageId } = req.body;
    if (!packageId) {
      throw new AppError("Package ID is required", 400);
    }
    const result = await WalletService.purchasePackage(req.user.userId, packageId);
    return successResponse(res, result, "Package purchased and activated successfully");
  } catch (error) {
    next(error);
  }
};

export const transferTokens = async (req, res, next) => {
  try {
    const { receiverUserId, amount } = req.body;
    if (!receiverUserId || !amount) {
      throw new AppError("Receiver user ID and transfer amount are required", 400);
    }
    const result = await WalletService.transferTokens(
      req.user.userId,
      receiverUserId,
      parseFloat(amount)
    );
    return successResponse(res, result, `Transferred ${amount} GFT tokens to user ${receiverUserId} successfully`);
  } catch (error) {
    next(error);
  }
};

export const requestWithdrawal = async (req, res, next) => {
  try {
    const { amount, paymentMethod, paymentDetails } = req.body;
    if (!amount || !paymentMethod || !paymentDetails) {
      throw new AppError("Amount, payment method, and destination details are required", 400);
    }
    const result = await WalletService.requestWithdrawal(
      req.user.userId,
      parseFloat(amount),
      paymentMethod,
      paymentDetails
    );
    return successResponse(res, result, "Withdrawal request submitted successfully");
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

