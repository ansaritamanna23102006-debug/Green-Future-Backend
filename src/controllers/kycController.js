/**
 * Green Future Tech (GFT) — KYC Controller
 * Phase 2: Controller endpoints for Member KYC and Administrative Verification
 */

import KycService from "../services/kycService.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

// ==========================================
// MEMBER KYC ENDPOINTS
// ==========================================

export const getMyKycProfile = async (req, res, next) => {
  try {
    const profile = KycService.getKycProfile(req.user);
    return successResponse(res, profile, "KYC profile retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const uploadKycDocuments = async (req, res, next) => {
  try {
    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    const profile = await KycService.uploadKycDocuments(req.user, req.files, req.body, reqInfo);
    return successResponse(res, profile, "KYC documents uploaded successfully", 200);
  } catch (error) {
    next(error);
  }
};

export const previewMyDocument = async (req, res, next) => {
  try {
    const { docType } = req.params;
    const docStream = await KycService.getDocumentStream(req.user, req.user.userId, docType);

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", docStream.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${docStream.originalName}"`);

    return res.sendFile(docStream.filePath);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN & SUPER ADMIN REVIEW ENDPOINTS
// ==========================================

export const getKycQueue = async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const result = await KycService.getKycQueue({ status, page, limit });
    return successResponse(res, result, "KYC review queue fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getMemberKycDetails = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { default: User } = await import("../models/User.js");
    const targetUser = await User.findOne({ userId });
    if (!targetUser) throw new AppError("User not found", 404);

    const profile = KycService.getKycProfile(targetUser);
    return successResponse(res, {
      userId: targetUser.userId,
      name: targetUser.name,
      email: targetUser.email,
      mobile: targetUser.mobile,
      registeredAt: targetUser.createdAt,
      kyc: profile,
    }, "Member KYC details fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const previewCandidateDocument = async (req, res, next) => {
  try {
    const { userId, docType } = req.params;
    // CORRECTION 1: Opening/viewing a document does NOT silently change status
    const docStream = await KycService.getDocumentStream(req.user, userId, docType);

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", docStream.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${docStream.originalName}"`);

    return res.sendFile(docStream.filePath);
  } catch (error) {
    next(error);
  }
};

export const startKycReview = async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) throw new AppError("Target userId is required", 400);

    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const profile = await KycService.startReview(req.user, userId, reqInfo);
    return successResponse(res, profile, "KYC review process formally started", 200);
  } catch (error) {
    next(error);
  }
};

export const submitKycDecision = async (req, res, next) => {
  try {
    const { userId, action, reason, flaggedDocuments } = req.body;
    if (!userId || !action) throw new AppError("userId and action are required", 400);

    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const profile = await KycService.reviewKyc(
      req.user,
      userId,
      action,
      { reason, flaggedDocuments },
      reqInfo
    );

    return successResponse(res, profile, `KYC decision '${action}' recorded successfully`, 200);
  } catch (error) {
    next(error);
  }
};

export const superAdminKycOverride = async (req, res, next) => {
  try {
    const { userId, reason } = req.body;
    if (!userId || !reason) throw new AppError("userId and reason are required", 400);

    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const profile = await KycService.superAdminOverride(req.user, userId, reason, reqInfo);
    return successResponse(res, profile, "Super Admin KYC override executed successfully", 200);
  } catch (error) {
    next(error);
  }
};
