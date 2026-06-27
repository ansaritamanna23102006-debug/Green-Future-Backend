import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import SupportTicket from "../models/SupportTicket.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import AppError from "../utils/errors.js";

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    return successResponse(res, user, "Profile fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { address, state, city, country, mobile } = req.body;
    const user = await User.findById(req.user._id);

    if (address) user.address = address;
    if (state) user.state = state;
    if (city) user.city = city;
    if (country) user.country = country;
    if (mobile) user.mobile = mobile;

    await user.save();
    return successResponse(res, user, "Profile updated successfully");
  } catch (error) {
    next(error);
  }
};

export const updateNominee = async (req, res, next) => {
  try {
    const { name, relation, mobile } = req.body;
    const user = await User.findById(req.user._id);

    user.nominee = {
      name: name || user.nominee.name,
      relation: relation || user.nominee.relation,
      mobile: mobile || user.nominee.mobile,
    };

    await user.save();
    return successResponse(res, user, "Nominee details updated successfully");
  } catch (error) {
    next(error);
  }
};

export const updateBankDetails = async (req, res, next) => {
  try {
    const { accountHolderName, accountNumber, bankName, ifscCode, branch } = req.body;
    const user = await User.findById(req.user._id);

    user.bankDetails = {
      accountHolderName: accountHolderName || user.bankDetails.accountHolderName,
      accountNumber: accountNumber || user.bankDetails.accountNumber,
      bankName: bankName || user.bankDetails.bankName,
      ifscCode: ifscCode || user.bankDetails.ifscCode,
      branch: branch || user.bankDetails.branch,
    };

    await user.save();
    
    // Log sensitive changes
    await AuditLog.create({
      userId: user.userId,
      action: "BANK_DETAILS_UPDATE",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      details: "Updated banking registration settings.",
    });

    return successResponse(res, user, "Bank details updated successfully");
  } catch (error) {
    next(error);
  }
};

export const updateCryptoWallet = async (req, res, next) => {
  try {
    const { usdtWalletAddress } = req.body;
    const user = await User.findById(req.user._id);

    user.usdtWalletAddress = usdtWalletAddress;
    await user.save();

    await AuditLog.create({
      userId: user.userId,
      action: "USDT_ADDRESS_UPDATE",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      details: `Updated USDT wallet destination to: ${usdtWalletAddress}`,
    });

    return successResponse(res, user, "USDT wallet address updated successfully");
  } catch (error) {
    next(error);
  }
};

export const submitKyc = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw new AppError("User not found", 404);

    const { aadhaarNumber, panNumber } = req.body;
    const files = req.files || {};

    if (!files.aadhaarFront || !files.aadhaarBack || !files.panCard || !files.bankPassbook) {
      throw new AppError("All four KYC documents are required (Aadhaar Front, Aadhaar Back, PAN Card, Bank Passbook)", 400);
    }

    // Upload files to Cloudinary and retrieve secure urls
    const aadhaarFrontUrl = await uploadToCloudinary(files.aadhaarFront[0].path, "kyc");
    const aadhaarBackUrl = await uploadToCloudinary(files.aadhaarBack[0].path, "kyc");
    const panUrl = await uploadToCloudinary(files.panCard[0].path, "kyc");
    const passbookUrl = await uploadToCloudinary(files.bankPassbook[0].path, "kyc");

    user.kyc = {
      status: "pending",
      rejectReason: "",
      aadhaarNumber: aadhaarNumber || user.kyc.aadhaarNumber,
      panNumber: panNumber || user.kyc.panNumber,
      aadhaarFrontUrl,
      aadhaarBackUrl,
      panUrl,
      passbookUrl,
      submittedAt: new Date(),
    };

    await user.save();

    await AuditLog.create({
      userId: user.userId,
      action: "KYC_SUBMIT",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      details: "Submitted KYC validation files.",
    });

    return successResponse(res, user, "KYC documents submitted for review successfully");
  } catch (error) {
    next(error);
  }
};

export const createUserTicket = async (req, res, next) => {
  try {
    const { subject, description, priority } = req.body;
    const ticket = await SupportTicket.create({
      user: req.user._id,
      userId: req.user.userId,
      subject,
      description,
      priority: priority || "medium",
    });
    return successResponse(res, ticket, "Support ticket created successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const getUserTickets = async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    return successResponse(res, tickets, "User support tickets fetched successfully");
  } catch (error) {
    next(error);
  }
};

