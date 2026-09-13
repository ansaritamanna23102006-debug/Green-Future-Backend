/**
 * Green Future Tech (GFT) — Authoritative KYC Service
 * Phase 2: KYC & Verification Workflow Engine
 * 
 * Implements:
 * - Deterministic KYC State Machine validation.
 * - Private, authenticated document streaming.
 * - Granular resubmission allowing replacement of only affected documents.
 * - Explicit "Start Review" transition (no silent auto-transition on view).
 * - Super Admin override rights.
 * - Complete audit logging without leaking sensitive identity numbers or paths.
 * - Safe email notifications.
 */

import path from "path";
import fs from "fs";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import sendEmail from "../config/mailer.js";
import {
  KYC_STATUS,
  REQUIRED_KYC_DOCUMENTS,
  isAllowedKycTransition,
  maskAadhaarNumber,
  maskPanNumber,
} from "../utils/rules/kycConstants.js";

const PRIVATE_KYC_BASE_DIR = path.resolve(process.cwd(), "storage", "private_kyc");

class KycService {
  /**
   * Returns normalized, sanitized KYC profile for the user.
   * Masks sensitive numbers and never exposes internal filesystem paths.
   */
  getKycProfile(user) {
    const kyc = user.kyc || {};
    
    // Normalize legacy status if any
    let status = kyc.status || KYC_STATUS.NOT_STARTED;
    if (status === "not_submitted") status = KYC_STATUS.NOT_STARTED;
    if (status === "pending") status = KYC_STATUS.SUBMITTED;
    if (status === "approved") status = KYC_STATUS.APPROVED;
    if (status === "rejected") status = KYC_STATUS.REJECTED;

    const docs = kyc.documents || {};
    const documentsStatus = {};

    REQUIRED_KYC_DOCUMENTS.forEach((docKey) => {
      const doc = docs[docKey];
      documentsStatus[docKey] = {
        uploaded: Boolean(doc && doc.fileName),
        originalName: doc ? doc.originalName : null,
        mimeType: doc ? doc.mimeType : null,
        size: doc ? doc.size : null,
        uploadedAt: doc ? doc.uploadedAt : null,
        requiresResubmission: Array.isArray(kyc.flaggedDocuments) && kyc.flaggedDocuments.includes(docKey),
      };
    });

    return {
      status,
      aadhaarNumber: maskAadhaarNumber(kyc.aadhaarNumber),
      panNumber: maskPanNumber(kyc.panNumber),
      documents: documentsStatus,
      flaggedDocuments: kyc.flaggedDocuments || [],
      rejectionReason: kyc.rejectionReason || "",
      resubmissionReason: kyc.resubmissionReason || "",
      submittedAt: kyc.submittedAt || null,
      reviewedAt: kyc.reviewedAt || null,
      reviewedBy: kyc.reviewedBy || null,
    };
  }

  /**
   * Uploads and/or updates KYC documents.
   * Supports granular replacement on RESUBMISSION_REQUIRED.
   */
  async uploadKycDocuments(user, files = {}, body = {}, reqInfo = {}) {
    if (!user) throw new AppError("User not found", 404);

    let currentStatus = user.kyc ? user.kyc.status : KYC_STATUS.NOT_STARTED;
    if (currentStatus === "not_submitted") currentStatus = KYC_STATUS.NOT_STARTED;
    if (currentStatus === "pending") currentStatus = KYC_STATUS.SUBMITTED;
    if (currentStatus === "approved") currentStatus = KYC_STATUS.APPROVED;
    if (currentStatus === "rejected") currentStatus = KYC_STATUS.REJECTED;

    if (currentStatus === KYC_STATUS.APPROVED) {
      throw new AppError("Your KYC is already approved and cannot be modified.", 400);
    }

    if (currentStatus === KYC_STATUS.SUBMITTED || currentStatus === KYC_STATUS.UNDER_REVIEW) {
      throw new AppError("Your KYC application is currently in review. Please wait for an administrator decision.", 400);
    }

    if (!user.kyc) {
      user.kyc = { status: KYC_STATUS.NOT_STARTED, documents: {}, flaggedDocuments: [], history: [] };
    }
    if (!user.kyc.documents) user.kyc.documents = {};

    const uploadedDocKeys = [];
    const isResubmission = currentStatus === KYC_STATUS.RESUBMISSION_REQUIRED;

    // Process uploaded files
    for (const docKey of REQUIRED_KYC_DOCUMENTS) {
      if (files[docKey] && files[docKey][0]) {
        const file = files[docKey][0];
        
        // If replacing an old file, unlink old private file safely
        if (user.kyc.documents[docKey] && user.kyc.documents[docKey].fileName) {
          const oldPath = path.join(PRIVATE_KYC_BASE_DIR, user.userId, user.kyc.documents[docKey].fileName);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }

        user.kyc.documents[docKey] = {
          fileName: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          uploadedAt: new Date(),
        };
        uploadedDocKeys.push(docKey);

        // If resubmitting, remove from flaggedDocuments list
        if (isResubmission && Array.isArray(user.kyc.flaggedDocuments)) {
          user.kyc.flaggedDocuments = user.kyc.flaggedDocuments.filter((d) => d !== docKey);
        }
      }
    }

    // Mask and store identity numbers if supplied
    if (body.aadhaarNumber) {
      user.kyc.aadhaarNumber = maskAadhaarNumber(body.aadhaarNumber);
    }
    if (body.panNumber) {
      user.kyc.panNumber = maskPanNumber(body.panNumber);
    }

    // Determine completion
    const allPresent = REQUIRED_KYC_DOCUMENTS.every(
      (key) => user.kyc.documents[key] && user.kyc.documents[key].fileName
    );
    const noFlaggedRemaining = !user.kyc.flaggedDocuments || user.kyc.flaggedDocuments.length === 0;

    // Submit defaults to true when all required docs are present unless explicitly marked false
    const submitRequested = body.submitForReview !== false && String(body.submitForReview).toLowerCase() !== "false";
    let targetStatus = user.kyc.status;

    if (allPresent && noFlaggedRemaining && submitRequested) {
      targetStatus = KYC_STATUS.SUBMITTED;
      user.kyc.submittedAt = new Date();
      user.kyc.flaggedDocuments = [];
      user.kyc.rejectionReason = "";
      user.kyc.resubmissionReason = "";
    } else if (user.kyc.status === KYC_STATUS.NOT_STARTED || isResubmission) {
      targetStatus = KYC_STATUS.DRAFT;
    }

    const prevStatus = user.kyc.status;
    user.kyc.status = targetStatus;

    // Record in history
    user.kyc.history.push({
      action: submitRequested ? "KYC_SUBMITTED" : "DOCUMENTS_UPLOADED",
      previousStatus: prevStatus,
      newStatus: targetStatus,
      changedBy: user.userId,
      reason: `Uploaded/replaced documents: ${uploadedDocKeys.join(", ") || "none"}`,
      timestamp: new Date(),
    });

    await user.save();

    // Log to AuditLog (Never leak full numbers or private paths)
    await AuditLog.create({
      userId: user.userId,
      action: submitRequested ? "KYC_SUBMIT" : "KYC_UPLOAD",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `User updated KYC documents [${uploadedDocKeys.join(", ")}]. Status: ${targetStatus}.`,
    });

    // Send transactional notification if submitted
    if (submitRequested && targetStatus === KYC_STATUS.SUBMITTED) {
      try {
        await sendEmail({
          to: user.email,
          subject: "Green Future Tech — KYC Documents Submitted for Verification",
          html: `
            <div style="font-family: sans-serif; padding: 24px; color: #0E3B2E; max-width: 500px; border: 1px solid #C9A34A; border-radius: 12px;">
              <h2 style="color: #0B5D43;">KYC Documents Received</h2>
              <p>Hello ${user.name},</p>
              <p>Your compliance verification documents have been received successfully and entered the verification queue.</p>
              <p>Our regulatory compliance team will review your submission. You will be notified once the review is completed.</p>
            </div>
          `,
        });
      } catch (mailErr) {
        console.warn(`KYC submit email notification failed: ${mailErr.message}`);
      }
    }

    return this.getKycProfile(user);
  }

  /**
   * Retrieves secure file stream path for an authorized document.
   * Verifies strict authorization: User can only access own files; Admin/Super Admin can access applicant files.
   */
  async getDocumentStream(requestingUser, targetUserId, docType) {
    if (!REQUIRED_KYC_DOCUMENTS.includes(docType)) {
      throw new AppError(`Invalid KYC document type: '${docType}'`, 400);
    }

    // Role-based authorization check
    const isStaff = requestingUser.role === "admin" || requestingUser.role === "superadmin";
    if (!isStaff && requestingUser.userId !== targetUserId) {
      throw new AppError("Unauthorized access to requested document", 403);
    }

    const targetUser = await User.findOne({ userId: targetUserId });
    if (!targetUser) throw new AppError("Target user not found", 404);

    const docMeta = targetUser.kyc && targetUser.kyc.documents ? targetUser.kyc.documents[docType] : null;
    if (!docMeta || !docMeta.fileName) {
      throw new AppError(`No uploaded file found for ${docType}`, 404);
    }

    const filePath = path.resolve(PRIVATE_KYC_BASE_DIR, targetUser.userId, docMeta.fileName);
    if (!fs.existsSync(filePath)) {
      throw new AppError("Document file not found on secure storage", 404);
    }

    return {
      filePath,
      mimeType: docMeta.mimeType || "application/octet-stream",
      originalName: docMeta.originalName || `${docType}.pdf`,
    };
  }

  /**
   * Explicitly starts review: SUBMITTED -> UNDER_REVIEW.
   * CORRECTION 1: Opening or viewing a document does NOT silently transition state.
   */
  async startReview(adminUser, targetUserId, reqInfo = {}) {
    const targetUser = await User.findOne({ userId: targetUserId });
    if (!targetUser) throw new AppError("Target user not found", 404);

    const currentStatus = targetUser.kyc ? targetUser.kyc.status : KYC_STATUS.NOT_STARTED;
    if (currentStatus !== KYC_STATUS.SUBMITTED) {
      throw new AppError(`Cannot start review. Application is currently in '${currentStatus}' status, not 'SUBMITTED'.`, 400);
    }

    targetUser.kyc.status = KYC_STATUS.UNDER_REVIEW;
    targetUser.kyc.reviewedBy = adminUser.userId;

    targetUser.kyc.history.push({
      action: "REVIEW_STARTED",
      previousStatus: currentStatus,
      newStatus: KYC_STATUS.UNDER_REVIEW,
      changedBy: adminUser.userId,
      reason: "Administrator initiated formal document verification",
      timestamp: new Date(),
    });

    await targetUser.save();

    await AuditLog.create({
      userId: adminUser.userId,
      action: "KYC_START_REVIEW",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `Admin ${adminUser.userId} formally started review for user ${targetUser.userId}.`,
    });

    return this.getKycProfile(targetUser);
  }

  /**
   * Reviews KYC application (APPROVE, REJECT, or RESUBMISSION_REQUIRED).
   */
  async reviewKyc(adminUser, targetUserId, action, payload = {}, reqInfo = {}) {
    const targetUser = await User.findOne({ userId: targetUserId });
    if (!targetUser) throw new AppError("Target user not found", 404);

    const currentStatus = targetUser.kyc ? targetUser.kyc.status : KYC_STATUS.NOT_STARTED;
    let cleanAction = String(action || "").toUpperCase().trim();
    if (cleanAction === "APPROVE") cleanAction = KYC_STATUS.APPROVED;
    if (cleanAction === "REJECT") cleanAction = KYC_STATUS.REJECTED;

    if (!isAllowedKycTransition(currentStatus, cleanAction, adminUser.role)) {
      throw new AppError(`Illegal KYC transition from '${currentStatus}' to '${cleanAction}' by ${adminUser.role}`, 400);
    }

    const previousStatus = currentStatus;
    const now = new Date();

    if (cleanAction === KYC_STATUS.APPROVED) {
      targetUser.kyc.status = KYC_STATUS.APPROVED;
      targetUser.kyc.reviewedAt = now;
      targetUser.kyc.reviewedBy = adminUser.userId;
      targetUser.kyc.rejectionReason = "";
      targetUser.kyc.resubmissionReason = "";
      targetUser.kyc.flaggedDocuments = [];
    } else if (cleanAction === KYC_STATUS.REJECTED) {
      const reason = String(payload.reason || "").trim();
      if (!reason) {
        throw new AppError("An explicit rejection reason is mandatory when rejecting KYC", 400);
      }
      targetUser.kyc.status = KYC_STATUS.REJECTED;
      targetUser.kyc.reviewedAt = now;
      targetUser.kyc.reviewedBy = adminUser.userId;
      targetUser.kyc.rejectionReason = reason;
    } else if (cleanAction === KYC_STATUS.RESUBMISSION_REQUIRED) {
      const reason = String(payload.reason || "").trim();
      const flagged = Array.isArray(payload.flaggedDocuments) ? payload.flaggedDocuments : [];

      if (!reason) {
        throw new AppError("An explicit resubmission instruction reason is mandatory", 400);
      }
      if (flagged.length === 0) {
        throw new AppError("At least one affected document must be identified for resubmission", 400);
      }

      for (const d of flagged) {
        if (!REQUIRED_KYC_DOCUMENTS.includes(d)) {
          throw new AppError(`Invalid document identifier for resubmission: '${d}'`, 400);
        }
      }

      targetUser.kyc.status = KYC_STATUS.RESUBMISSION_REQUIRED;
      targetUser.kyc.reviewedAt = now;
      targetUser.kyc.reviewedBy = adminUser.userId;
      targetUser.kyc.resubmissionReason = reason;
      targetUser.kyc.flaggedDocuments = flagged;
    }

    targetUser.kyc.history.push({
      action: `DECISION_${cleanAction}`,
      previousStatus,
      newStatus: cleanAction,
      changedBy: adminUser.userId,
      reason: payload.reason || "Approved",
      timestamp: now,
    });

    await targetUser.save();

    await AuditLog.create({
      userId: adminUser.userId,
      action: "KYC_DECISION",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `Admin ${adminUser.userId} transitioned user ${targetUser.userId} from ${previousStatus} to ${cleanAction}. Reason: ${payload.reason || "N/A"}`,
    });

    // Send notification email (Never leak sensitive numbers or private paths)
    try {
      let emailSubject = "Green Future Tech — KYC Status Update";
      let emailBody = "";

      if (cleanAction === KYC_STATUS.APPROVED) {
        emailSubject = "Green Future Tech — KYC Verification Approved";
        emailBody = `<p>Congratulations ${targetUser.name}! Your compliance verification has been officially approved.</p>`;
      } else if (cleanAction === KYC_STATUS.REJECTED) {
        emailSubject = "Green Future Tech — KYC Verification Rejected";
        emailBody = `<p>Your compliance verification was not approved.</p><p><strong>Reason:</strong> ${payload.reason}</p><p>Please reach out to support if you have questions.</p>`;
      } else if (cleanAction === KYC_STATUS.RESUBMISSION_REQUIRED) {
        emailSubject = "Green Future Tech — KYC Action Required (Document Resubmission)";
        emailBody = `
          <p>Hello ${targetUser.name},</p>
          <p>Our regulatory review team requires updated scans for the following document(s):</p>
          <ul>${(payload.flaggedDocuments || []).map((d) => `<li><strong>${d}</strong></li>`).join("")}</ul>
          <p><strong>Instructions:</strong> ${payload.reason}</p>
          <p>You can replace only the requested documents by visiting your member profile compliance tab.</p>
        `;
      }

      await sendEmail({
        to: targetUser.email,
        subject: emailSubject,
        html: `
          <div style="font-family: sans-serif; padding: 24px; color: #0E3B2E; max-width: 500px; border: 1px solid #C9A34A; border-radius: 12px;">
            <h2 style="color: #0B5D43;">KYC Verification Notice</h2>
            ${emailBody}
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn(`KYC decision email notification failed: ${mailErr.message}`);
    }

    return this.getKycProfile(targetUser);
  }

  /**
   * Super Admin Override: Reopens an APPROVED KYC back to UNDER_REVIEW.
   * Strictly restricted to superadmin role.
   */
  async superAdminOverride(superAdminUser, targetUserId, reason, reqInfo = {}) {
    if (superAdminUser.role !== "superadmin") {
      throw new AppError("Only Super Administrators hold override authority to reopen approved KYC", 403);
    }

    const cleanReason = String(reason || "").trim();
    if (!cleanReason) {
      throw new AppError("A reason is mandatory for Super Admin KYC override", 400);
    }

    const targetUser = await User.findOne({ userId: targetUserId });
    if (!targetUser) throw new AppError("Target user not found", 404);

    const prevStatus = targetUser.kyc ? targetUser.kyc.status : KYC_STATUS.NOT_STARTED;
    if (prevStatus !== KYC_STATUS.APPROVED) {
      throw new AppError("Super Admin override can only be performed on currently 'APPROVED' records", 400);
    }

    targetUser.kyc.status = KYC_STATUS.UNDER_REVIEW;
    targetUser.kyc.rejectionReason = "";
    targetUser.kyc.resubmissionReason = "";
    targetUser.kyc.history.push({
      action: "SUPERADMIN_OVERRIDE",
      previousStatus: prevStatus,
      newStatus: KYC_STATUS.UNDER_REVIEW,
      changedBy: superAdminUser.userId,
      reason: cleanReason,
      timestamp: new Date(),
    });

    await targetUser.save();

    await AuditLog.create({
      userId: superAdminUser.userId,
      action: "KYC_SUPERADMIN_OVERRIDE",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `Super Admin ${superAdminUser.userId} reopened APPROVED KYC for ${targetUser.userId}. Reason: ${cleanReason}`,
    });

    return this.getKycProfile(targetUser);
  }

  /**
   * Fetches paginated review queue with status filter for Admin.
   */
  async getKycQueue({ status = "SUBMITTED", page = 1, limit = 10 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status && status !== "ALL") {
      filter["kyc.status"] = status;
    } else {
      filter["kyc.status"] = { $in: [KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW, KYC_STATUS.RESUBMISSION_REQUIRED] };
    }

    const users = await User.find(filter)
      .sort({ "kyc.submittedAt": -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select("userId name email mobile kyc createdAt");

    const total = await User.countDocuments(filter);

    const items = users.map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      kyc: this.getKycProfile(u),
      registeredAt: u.createdAt,
    }));

    return {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }
}

export default new KycService();
