/**
 * Green Future Tech (GFT) — Authoritative KYC Constants & Rules
 * Phase 2: KYC & Verification Workflow Engine
 * 
 * Defines strict state machine constants, required document keys,
 * transition validation matrices, and data minimization helpers.
 */

export const KYC_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  RESUBMISSION_REQUIRED: "RESUBMISSION_REQUIRED",
});

export const REQUIRED_KYC_DOCUMENTS = Object.freeze([
  "aadhaarFront",
  "aadhaarBack",
  "panCard",
  "bankPassbook",
]);

export const ALLOWED_KYC_EXTENSIONS = Object.freeze([
  ".jpg",
  ".jpeg",
  ".png",
  ".pdf",
]);

export const ALLOWED_KYC_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

export const KYC_FILE_LIMITS = Object.freeze({
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB per document
  MAX_REQUEST_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB total per multipart request
});

/**
 * Validates whether a requested KYC state transition is permissible.
 * 
 * Transition rules:
 * - NOT_STARTED -> DRAFT, SUBMITTED
 * - DRAFT -> SUBMITTED
 * - SUBMITTED -> UNDER_REVIEW (Only through explicit Admin "Start Review")
 * - UNDER_REVIEW -> APPROVED, REJECTED, RESUBMISSION_REQUIRED
 * - RESUBMISSION_REQUIRED -> DRAFT, SUBMITTED
 * - REJECTED -> DRAFT (Only through authorized Admin/Super Admin re-initiation)
 * - APPROVED -> UNDER_REVIEW (Strictly Super Admin override only)
 */
export const isAllowedKycTransition = (currentStatus, targetStatus, userRole = "user") => {
  if (currentStatus === targetStatus) return true;

  switch (currentStatus) {
    case KYC_STATUS.NOT_STARTED:
      return targetStatus === KYC_STATUS.DRAFT || targetStatus === KYC_STATUS.SUBMITTED;

    case KYC_STATUS.DRAFT:
      return targetStatus === KYC_STATUS.SUBMITTED;

    case KYC_STATUS.SUBMITTED:
      // Can ONLY move to UNDER_REVIEW through explicit Admin start-review
      return targetStatus === KYC_STATUS.UNDER_REVIEW && (userRole === "admin" || userRole === "superadmin");

    case KYC_STATUS.UNDER_REVIEW:
      return (
        (userRole === "admin" || userRole === "superadmin") &&
        [KYC_STATUS.APPROVED, KYC_STATUS.REJECTED, KYC_STATUS.RESUBMISSION_REQUIRED].includes(targetStatus)
      );

    case KYC_STATUS.RESUBMISSION_REQUIRED:
      return targetStatus === KYC_STATUS.DRAFT || targetStatus === KYC_STATUS.SUBMITTED;

    case KYC_STATUS.REJECTED:
      // Re-initiation back to DRAFT requires Admin or Super Admin action
      return targetStatus === KYC_STATUS.DRAFT && (userRole === "admin" || userRole === "superadmin");

    case KYC_STATUS.APPROVED:
      // Super Admin override ONLY
      return targetStatus === KYC_STATUS.UNDER_REVIEW && userRole === "superadmin";

    default:
      return false;
  }
};

/**
 * Masks sensitive Indian identity numbers according to data minimization principles.
 * Never stores or returns unmasked values.
 */
export const maskAadhaarNumber = (rawNumber) => {
  if (!rawNumber) return "";
  const clean = String(rawNumber).replace(/\D/g, "");
  if (clean.length < 4) return "XXXX-XXXX-XXXX";
  const last4 = clean.slice(-4);
  return `XXXX-XXXX-${last4}`;
};

export const maskPanNumber = (rawPan) => {
  if (!rawPan) return "";
  const clean = String(rawPan).trim().toUpperCase();
  if (clean.length < 4) return "XXXXX0000X";
  const first2 = clean.slice(0, 2);
  const last2 = clean.slice(-2);
  return `${first2}XXXXX${last2}`;
};
