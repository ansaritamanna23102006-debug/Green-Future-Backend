import User from "../models/User.js";
import Settings from "../models/Settings.js";
import AuditLog from "../models/AuditLog.js";
import IncomeService from "../services/incomeService.js";
import NetworkService from "../services/networkService.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";
import fs from "fs";
import path from "path";

export const getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ key: "global_settings" });
    if (!settings) {
      settings = await Settings.create({ key: "global_settings" });
    }
    return successResponse(res, settings, "Settings fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ key: "global_settings" });
    if (!settings) {
      settings = new Settings({ key: "global_settings" });
    }

    const fields = [
      "directIncomePercentage",
      "binaryIncomePercentage",
      "kycRequiredForWithdrawal",
      "minWithdrawalAmount",
      "stakingAPY",
      "silverThreshold",
      "goldThreshold",
      "emeraldThreshold",
      "platinumThreshold",
      "diamondThreshold",
      "rubyThreshold",
      "chairmanThreshold",
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        settings[field] = req.body[field];
      }
    });

    await settings.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "SETTINGS_UPDATE",
      details: "Updated global platform parameters and matching thresholds.",
    });

    return successResponse(res, settings, "Global settings updated successfully");
  } catch (error) {
    next(error);
  }
};

export const createAdminUser = async (req, res, next) => {
  try {
    const { name, email, mobile, password } = req.body;
    
    // Check if email already exists
    const emailExists = await User.findOne({ email });
    if (emailExists) throw new AppError("Email is already registered", 400);

    const randDigits = Math.floor(100000 + Math.random() * 900000);
    const userId = `ADM${randDigits}`;

    const admin = await User.create({
      userId,
      sponsorId: "none",
      name,
      email,
      mobile,
      password,
      role: "admin",
      status: "active",
      referralCode: `ADM-${randDigits}`,
    });

    return successResponse(res, {
      userId: admin.userId,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    }, "Administrator account created successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const getAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({ role: "admin" }).select("-password");
    return successResponse(res, admins, "Admins list fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    return successResponse(res, logs, "Audit logs fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getSystemLogFiles = async (req, res, next) => {
  try {
    const logFilePath = path.join("logs", "combined.log");
    if (!fs.existsSync(logFilePath)) {
      return successResponse(res, "", "No system logs recorded yet.");
    }
    const logData = fs.readFileSync(logFilePath, "utf8");
    // Return last 200 lines
    const lines = logData.split("\n").slice(-200).join("\n");
    return successResponse(res, lines, "System logs fetched successfully");
  } catch (error) {
    next(error);
  }
};

// Manual Cron Triggers for testing and instant settlements
export const triggerBinaryMatchingCalculation = async (req, res, next) => {
  try {
    await IncomeService.runWeeklyBinaryMatching();
    await NetworkService.checkAllUsersRankPromotions();
    
    await AuditLog.create({
      userId: req.user.userId,
      action: "MANUAL_CRON_TRIGGER",
      details: "Triggered binary matching and rank promotion sweep manually.",
    });

    return successResponse(res, null, "Manual binary matching and promotions calculations complete.");
  } catch (error) {
    next(error);
  }
};

export const getTokenSupplyMetrics = async (req, res, next) => {
  try {
    const { default: tokenSupplyService } = await import("../services/tokenSupplyService.js");
    const supply = await tokenSupplyService.getSupply();
    
    const activeIds = await User.countDocuments({ role: "user", status: "active" });
    const inactiveIds = await User.countDocuments({ role: "user", status: "inactive" });
    
    return successResponse(res, {
      totalSupply: supply.totalSupply,
      availableSupply: supply.availableSupply,
      reservedTokens: supply.reservedTokens,
      distributedBonuses: supply.distributedBonuses,
      returnedTokens: supply.returnedTokens,
      totalWithdrawalsINR: supply.totalWithdrawalsINR,
      totalWithdrawalsUSDT: supply.totalWithdrawalsUSDT,
      activeIds,
      inactiveIds
    }, "Token supply metrics fetched successfully");
  } catch (error) {
    next(error);
  }
};
