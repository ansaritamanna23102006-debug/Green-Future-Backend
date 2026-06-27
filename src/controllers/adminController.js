import User from "../models/User.js";
import Withdrawal from "../models/Withdrawal.js";
import Genealogy from "../models/Genealogy.js";
import WalletService from "../services/walletService.js";
import Announcement from "../models/Announcement.js";
import Offer from "../models/Offer.js";
import SupportTicket from "../models/SupportTicket.js";
import Document from "../models/Document.js";
import AuditLog from "../models/AuditLog.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

// Users Management
export const getAllUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "10");
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { email: { $regex: req.query.search, $options: "i" } },
        { userId: { $regex: req.query.search, $options: "i" } },
      ];
    }

    const count = await User.countDocuments(query);
    const users = await User.find(query).select("-password").skip(skip).limit(limit);

    return successResponse(res, {
      users,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalItems: count,
    }, "Users fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const updateUserStatus = async (req, res, next) => {
  try {
    const { userId, status } = req.body;
    if (!["active", "inactive", "suspended"].includes(status)) {
      throw new AppError("Invalid status value", 400);
    }

    const user = await User.findOneAndUpdate(
      { userId },
      { status },
      { new: true }
    ).select("-password");

    if (!user) throw new AppError("User not found", 404);

    await AuditLog.create({
      userId: req.user.userId,
      action: "USER_STATUS_CHANGE",
      details: `Changed status of user ${userId} to: ${status}`,
    });

    return successResponse(res, user, `User status updated to ${status} successfully`);
  } catch (error) {
    next(error);
  }
};

// KYC Verification
export const reviewKyc = async (req, res, next) => {
  try {
    const { userId, status, rejectReason } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      throw new AppError("Invalid status. Must be approved or rejected.", 400);
    }

    const user = await User.findOne({ userId });
    if (!user) throw new AppError("User not found", 404);

    user.kyc.status = status;
    user.kyc.rejectReason = status === "rejected" ? rejectReason || "Documents unclear" : "";
    user.kyc.reviewedAt = new Date();
    await user.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: "KYC_REVIEW",
      details: `Reviewed KYC for user ${userId}. Result: ${status}.`,
    });

    return successResponse(res, user, `KYC status updated to ${status} successfully`);
  } catch (error) {
    next(error);
  }
};

// Withdrawals Management
export const getAllWithdrawals = async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const withdrawals = await Withdrawal.find(query).sort({ createdAt: -1 });
    return successResponse(res, withdrawals, "Withdrawals list fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const updateWithdrawalStatus = async (req, res, next) => {
  try {
    const { withdrawalId, status, txHash, rejectReason } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      throw new AppError("Status must be approved or rejected", 400);
    }

    let withdrawal;
    if (status === "approved") {
      withdrawal = await WalletService.approveWithdrawal(withdrawalId, txHash);
    } else {
      withdrawal = await WalletService.rejectWithdrawal(withdrawalId, rejectReason);
    }

    await AuditLog.create({
      userId: req.user.userId,
      action: "WITHDRAWAL_REVIEW",
      details: `Processed withdrawal ID ${withdrawalId}. Status: ${status}`,
    });

    return successResponse(res, withdrawal, `Withdrawal request successfully ${status}`);
  } catch (error) {
    next(error);
  }
};

// Support Ticket Management
export const getSupportTickets = async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    const tickets = await SupportTicket.find(query).sort({ updatedAt: -1 });
    return successResponse(res, tickets, "Support tickets fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const replySupportTicket = async (req, res, next) => {
  try {
    const { ticketId, message } = req.body;
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new AppError("Ticket not found", 404);

    ticket.replies.push({
      sender: "Admin",
      message,
    });
    ticket.status = "in_progress";
    await ticket.save();

    return successResponse(res, ticket, "Reply submitted successfully");
  } catch (error) {
    next(error);
  }
};

export const closeSupportTicket = async (req, res, next) => {
  try {
    const { ticketId } = req.body;
    const ticket = await SupportTicket.findByIdAndUpdate(
      ticketId,
      { status: "closed" },
      { new: true }
    );
    if (!ticket) throw new AppError("Ticket not found", 404);
    return successResponse(res, ticket, "Ticket closed successfully");
  } catch (error) {
    next(error);
  }
};

// Announcements
export const createAnnouncement = async (req, res, next) => {
  try {
    const { title, content, type } = req.body;
    const announcement = await Announcement.create({
      title,
      content,
      type,
      createdBy: req.user.userId,
    });
    return successResponse(res, announcement, "Announcement created successfully", 201);
  } catch (error) {
    next(error);
  }
};

// Offers
export const createOffer = async (req, res, next) => {
  try {
    const { title, description, expiryDate } = req.body;
    const bannerFile = req.file;
    if (!bannerFile) throw new AppError("Banner image is required", 400);

    const bannerUrl = await uploadToCloudinary(bannerFile.path, "offers");

    const offer = await Offer.create({
      title,
      description,
      bannerUrl,
      expiryDate: new Date(expiryDate),
    });

    return successResponse(res, offer, "Offer banner uploaded and created successfully", 201);
  } catch (error) {
    next(error);
  }
};

// Company Documents
export const uploadCompanyDocument = async (req, res, next) => {
  try {
    const { title, description } = req.body;
    const docFile = req.file;
    if (!docFile) throw new AppError("Document file is required", 400);

    const fileUrl = await uploadToCloudinary(docFile.path, "documents");

    const document = await Document.create({
      title,
      description,
      fileUrl,
      fileType: docFile.mimetype.includes("pdf") ? "PDF" : "IMAGE",
    });

    return successResponse(res, document, "Document uploaded successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const editUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, email, mobile, rank, address, state, city, country } = req.body;
    const user = await User.findOne({ userId });
    if (!user) throw new AppError("User not found", 404);

    if (name) user.name = name;
    if (email) user.email = email;
    if (mobile) user.mobile = mobile;
    if (rank) user.rank = rank;
    if (address) user.address = address;
    if (state) user.state = state;
    if (city) user.city = city;
    if (country) user.country = country;

    await user.save();
    return successResponse(res, user, "User updated successfully");
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findOneAndDelete({ userId });
    if (!user) throw new AppError("User not found", 404);

    // Clean up genealogy link if any
    await Genealogy.findOneAndDelete({ userId });

    return successResponse(res, null, "User deleted successfully");
  } catch (error) {
    next(error);
  }
};

