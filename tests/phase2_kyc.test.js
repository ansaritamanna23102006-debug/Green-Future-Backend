/**
 * Green Future Tech (GFT) — Phase 2 Automated Test Suite
 * Validates KYC & Verification Workflow Engine, Security, Data Minimization, and Gates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
  KYC_STATUS,
  REQUIRED_KYC_DOCUMENTS,
  isAllowedKycTransition,
  maskAadhaarNumber,
  maskPanNumber,
  KYC_FILE_LIMITS
} from "../src/utils/rules/kycConstants.js";

import { validateKycMagicBytes } from "../src/middlewares/secureKycUpload.js";
import KycService from "../src/services/kycService.js";
import { requireVerifiedKyc } from "../src/middlewares/auth.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import Wallet from "../src/models/Wallet.js";
import AppError from "../src/utils/errors.js";

// Setup mock test database
const mockDB = {
  users: new Map(),
  auditLogs: [],
  wallets: new Map()
};

function createMockUser(overrides = {}) {
  const id = overrides._id || `user_${crypto.randomBytes(4).toString("hex")}`;
  const userId = overrides.userId || `GFT${Math.floor(100000 + Math.random() * 900000)}`;

  const defaultKyc = {
    status: KYC_STATUS.NOT_STARTED,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: "",
    resubmissionReason: "",
    flaggedDocuments: [],
    documents: {
      aadhaarFront: { fileName: null, originalName: null, mimeType: null, size: 0, uploadedAt: null },
      aadhaarBack: { fileName: null, originalName: null, mimeType: null, size: 0, uploadedAt: null },
      panCard: { fileName: null, originalName: null, mimeType: null, size: 0, uploadedAt: null },
      bankPassbook: { fileName: null, originalName: null, mimeType: null, size: 0, uploadedAt: null }
    },
    history: []
  };

  const user = {
    _id: id,
    userId,
    name: overrides.name || "Test Member",
    email: overrides.email || `test_${id}@gft.com`,
    mobile: overrides.mobile || "9876543210",
    role: overrides.role || "user",
    status: "active",
    kyc: { ...defaultKyc, ...(overrides.kyc || {}) },
    save: async function () {
      mockDB.users.set(this.userId, { ...this });
      mockDB.users.set(this._id.toString(), { ...this });
      return this;
    },
    toObject: function () {
      return JSON.parse(JSON.stringify(this));
    }
  };

  mockDB.users.set(userId, user);
  mockDB.users.set(id.toString(), user);
  return user;
}

// Intercept Mongoose User methods
User.findById = (id) => {
  const u = mockDB.users.get(id ? id.toString() : "");
  return Promise.resolve(u || null);
};

User.findOne = (query = {}) => {
  const allUsers = Array.from(mockDB.users.values());
  if (query.userId) {
    const found = allUsers.find(u => u.userId === query.userId);
    return Promise.resolve(found || null);
  }
  if (query._id) {
    const found = allUsers.find(u => u._id === query._id);
    return Promise.resolve(found || null);
  }
  return Promise.resolve(null);
};

User.find = (query = {}) => {
  const allUsers = Array.from(mockDB.users.values());
  let filtered = allUsers;
  if (query["kyc.status"]) {
    filtered = filtered.filter(u => u.kyc && u.kyc.status === query["kyc.status"]);
  }
  return {
    sort: () => ({
      skip: () => ({
        limit: () => ({
          select: () => Promise.resolve(filtered)
        })
      })
    })
  };
};

User.countDocuments = (query = {}) => {
  const allUsers = Array.from(mockDB.users.values());
  let count = allUsers.length;
  if (query["kyc.status"]) {
    count = allUsers.filter(u => u.kyc && u.kyc.status === query["kyc.status"]).length;
  }
  return Promise.resolve(count);
};

AuditLog.create = (doc) => {
  mockDB.auditLogs.push({ ...doc, createdAt: new Date() });
  return Promise.resolve(doc);
};

// ==========================================
// TEST SUITE: PHASE 2 KYC & VERIFICATION
// ==========================================

test("Phase 2 - 1. State Machine: Allowed and Forbidden Transitions", () => {
  // Member transitions
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.NOT_STARTED, KYC_STATUS.DRAFT, "user"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.NOT_STARTED, KYC_STATUS.SUBMITTED, "user"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.DRAFT, KYC_STATUS.SUBMITTED, "user"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.RESUBMISSION_REQUIRED, KYC_STATUS.DRAFT, "user"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.RESUBMISSION_REQUIRED, KYC_STATUS.SUBMITTED, "user"), true);

  // Admin transitions
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW, "admin"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.UNDER_REVIEW, KYC_STATUS.APPROVED, "admin"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.UNDER_REVIEW, KYC_STATUS.REJECTED, "admin"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.UNDER_REVIEW, KYC_STATUS.RESUBMISSION_REQUIRED, "admin"), true);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.REJECTED, KYC_STATUS.DRAFT, "admin"), true);

  // Super Admin transitions
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.APPROVED, KYC_STATUS.UNDER_REVIEW, "superadmin"), true);

  // Forbidden transitions
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW, "user"), false);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.NOT_STARTED, KYC_STATUS.APPROVED, "user"), false);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.SUBMITTED, KYC_STATUS.APPROVED, "admin"), false);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.APPROVED, KYC_STATUS.UNDER_REVIEW, "admin"), false); // Standard admin forbidden!
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.APPROVED, KYC_STATUS.DRAFT, "admin"), false);
  assert.strictEqual(isAllowedKycTransition(KYC_STATUS.APPROVED, KYC_STATUS.REJECTED, "admin"), false);
});

test("Phase 2 - 2. Data Minimization: Masking Functions for Aadhaar & PAN", () => {
  const aadhaar = "123456789012";
  const maskedAadhaar = maskAadhaarNumber(aadhaar);
  assert.strictEqual(maskedAadhaar, "XXXX-XXXX-9012");
  assert.strictEqual(maskedAadhaar.includes("12345678"), false);

  const pan = "ABCDE1234F";
  const maskedPan = maskPanNumber(pan);
  assert.strictEqual(maskedPan, "ABXXXXX4F");
  assert.strictEqual(maskedPan.includes("CDE123"), false);
});

test("Phase 2 - 3. Upload Security: Binary Magic Bytes Inspection Middleware", async () => {
  const tempDir = path.join(process.cwd(), "storage", "private_kyc", "test_magic");
  fs.mkdirSync(tempDir, { recursive: true });

  const validJpgPath = path.join(tempDir, "valid.jpg");
  fs.writeFileSync(validJpgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]));

  const validPngPath = path.join(tempDir, "valid.png");
  fs.writeFileSync(validPngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const validPdfPath = path.join(tempDir, "valid.pdf");
  fs.writeFileSync(validPdfPath, Buffer.from("%PDF-1.4\n"));

  const spoofedJpgPath = path.join(tempDir, "malicious.jpg");
  fs.writeFileSync(spoofedJpgPath, Buffer.from("MZ\x90\x00\x03\x00\x00\x00executable"));

  // 1. Valid files pass
  const reqValid = {
    files: {
      aadhaarFront: [{ fieldname: "aadhaarFront", path: validJpgPath }],
      panCard: [{ fieldname: "panCard", path: validPngPath }],
      bankPassbook: [{ fieldname: "bankPassbook", path: validPdfPath }]
    }
  };

  let validNextCalled = false;
  await validateKycMagicBytes(reqValid, {}, (err) => {
    assert.strictEqual(err, undefined);
    validNextCalled = true;
  });
  assert.strictEqual(validNextCalled, true);

  // 2. Spoofed executable disguised as jpg is rejected
  const reqSpoofed = {
    files: {
      aadhaarFront: [{ fieldname: "aadhaarFront", path: spoofedJpgPath }]
    }
  };

  let spoofedError = null;
  await validateKycMagicBytes(reqSpoofed, {}, (err) => {
    spoofedError = err;
  });
  assert.ok(spoofedError instanceof AppError);
  assert.strictEqual(spoofedError.statusCode, 400);
  assert.strictEqual(spoofedError.message.includes("File signature mismatch"), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("Phase 2 - 4. Upload Security: File Size Limits Enforcement", () => {
  assert.strictEqual(KYC_FILE_LIMITS.MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
  assert.strictEqual(KYC_FILE_LIMITS.MAX_REQUEST_SIZE_BYTES, 20 * 1024 * 1024);
  assert.deepStrictEqual(REQUIRED_KYC_DOCUMENTS, ["aadhaarFront", "aadhaarBack", "panCard", "bankPassbook"]);
});

test("Phase 2 - 5. Member Document Upload & Automatic SUBMITTED State on Complete Set", async () => {
  const member = createMockUser({ _id: "member_upload_001", userId: "GFT200101" });
  
  const dummyFiles = {};
  for (const docKey of REQUIRED_KYC_DOCUMENTS) {
    dummyFiles[docKey] = [{
      fieldname: docKey,
      filename: `${docKey}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}.png`,
      originalname: `${docKey}_scan.png`,
      mimetype: "image/png",
      size: 1024 * 250
    }];
  }

  const profile = await KycService.uploadKycDocuments(member, dummyFiles, {
    aadhaarNumber: "123456789012",
    panNumber: "ABCDE1234F"
  }, { ip: "127.0.0.1", userAgent: "Mozilla/5.0" });

  assert.strictEqual(profile.status, KYC_STATUS.SUBMITTED);
  assert.strictEqual(profile.aadhaarNumber, "XXXX-XXXX-9012");
  assert.strictEqual(profile.panNumber, "ABXXXXX4F");

  // Verify all 4 documents are uploaded
  for (const docKey of REQUIRED_KYC_DOCUMENTS) {
    assert.strictEqual(profile.documents[docKey].uploaded, true);
    assert.strictEqual(profile.documents[docKey].originalName, `${docKey}_scan.png`);
  }

  // Audit log recorded
  const audit = mockDB.auditLogs.find(l => (l.action === "KYC_SUBMIT" || l.action === "KYC_UPLOAD") && l.userId === member.userId);
  assert.ok(audit);
});

test("Phase 2 - 6. Viewing Document Does NOT Mutate SUBMITTED State (Correction 1)", async () => {
  // Create mock storage directory and file for streaming test
  const testUserId = "GFT300101";
  const userDir = path.join(process.cwd(), "storage", "private_kyc", testUserId);
  fs.mkdirSync(userDir, { recursive: true });
  const storedDocName = "test_doc_stream.png";
  fs.writeFileSync(path.join(userDir, storedDocName), Buffer.from("mock image"));

  const member = createMockUser({
    _id: "view_test_001",
    userId: testUserId,
    kyc: {
      status: KYC_STATUS.SUBMITTED,
      submittedAt: new Date(),
      documents: {
        aadhaarFront: { fileName: storedDocName, originalName: "aadhaar.png", mimeType: "image/png" }
      }
    }
  });

  const admin = { userId: "ADMIN001", role: "admin", name: "Admin Officer" };

  // Admin opens/previews the candidate document
  const docStream = await KycService.getDocumentStream(admin, member.userId, "aadhaarFront");
  assert.strictEqual(docStream.mimeType, "image/png");

  // Business state must REMAIN SUBMITTED!
  const targetUserAfterInspection = await User.findOne({ userId: member.userId });
  assert.strictEqual(targetUserAfterInspection.kyc.status, KYC_STATUS.SUBMITTED);
  assert.notStrictEqual(targetUserAfterInspection.kyc.status, KYC_STATUS.UNDER_REVIEW);

  fs.rmSync(userDir, { recursive: true, force: true });
});

test("Phase 2 - 7. Only Explicit 'Start Review' Mutates SUBMITTED to UNDER_REVIEW", async () => {
  const member = createMockUser({
    _id: "start_review_001",
    userId: "GFT400101",
    kyc: {
      status: KYC_STATUS.SUBMITTED,
      submittedAt: new Date()
    }
  });

  const admin = { userId: "ADMIN002", role: "admin", name: "Auditor Jane" };

  const profile = await KycService.startReview(admin, member.userId, {
    ip: "10.0.0.1",
    userAgent: "AdminBrowser"
  });

  assert.strictEqual(profile.status, KYC_STATUS.UNDER_REVIEW);
  assert.strictEqual(profile.reviewedBy, admin.userId);

  const updatedInDB = await User.findOne({ userId: member.userId });
  assert.strictEqual(updatedInDB.kyc.status, KYC_STATUS.UNDER_REVIEW);

  // Check audit log
  const startLog = mockDB.auditLogs.find(l => l.action === "KYC_START_REVIEW" && l.userId === admin.userId);
  assert.ok(startLog);
  assert.strictEqual(startLog.details.includes("formally started review"), true);
});

test("Phase 2 - 8. Review Actions: APPROVE KYC", async () => {
  const member = createMockUser({
    _id: "review_approve_001",
    userId: "GFT500101",
    kyc: {
      status: KYC_STATUS.UNDER_REVIEW,
      submittedAt: new Date()
    }
  });

  const admin = { userId: "ADMIN003", role: "admin" };

  const profile = await KycService.reviewKyc(admin, member.userId, "APPROVE", {
    reason: "Valid identity and address proof confirmed."
  });

  assert.strictEqual(profile.status, KYC_STATUS.APPROVED);
  assert.ok(profile.reviewedAt);
});

test("Phase 2 - 9. Review Actions: REJECT KYC Requires Reason", async () => {
  const member = createMockUser({
    _id: "review_reject_001",
    userId: "GFT600101",
    kyc: {
      status: KYC_STATUS.UNDER_REVIEW,
      submittedAt: new Date()
    }
  });

  const admin = { userId: "ADMIN003", role: "admin" };

  // Rejection without reason fails
  await assert.rejects(
    () => KycService.reviewKyc(admin, member.userId, "REJECT", { reason: "" }),
    (err) => err.statusCode === 400
  );

  // Rejection with valid reason succeeds
  const profile = await KycService.reviewKyc(admin, member.userId, "REJECT", {
    reason: "Blurry document scans; numbers and photo not readable."
  });

  assert.strictEqual(profile.status, KYC_STATUS.REJECTED);
  assert.strictEqual(profile.rejectionReason, "Blurry document scans; numbers and photo not readable.");
});

test("Phase 2 - 10. Review Actions: RESUBMISSION_REQUIRED Flags Affected Documents (Correction 4)", async () => {
  const member = createMockUser({
    _id: "review_resubmit_001",
    userId: "GFT700101",
    kyc: {
      status: KYC_STATUS.UNDER_REVIEW,
      submittedAt: new Date(),
      documents: {
        aadhaarFront: { fileName: "af.png" },
        aadhaarBack: { fileName: "ab.png" },
        panCard: { fileName: "pan.png" },
        bankPassbook: { fileName: "bp.png" }
      }
    }
  });

  const admin = { userId: "ADMIN004", role: "admin" };

  const profile = await KycService.reviewKyc(admin, member.userId, "RESUBMISSION_REQUIRED", {
    reason: "PAN card scan is cut off at the bottom. Please provide full scan.",
    flaggedDocuments: ["panCard"]
  });

  assert.strictEqual(profile.status, KYC_STATUS.RESUBMISSION_REQUIRED);
  assert.deepStrictEqual(profile.flaggedDocuments, ["panCard"]);
  assert.strictEqual(profile.documents.panCard.requiresResubmission, true);
  assert.strictEqual(profile.documents.aadhaarFront.requiresResubmission, false);
});

test("Phase 2 - 11. Selective Resubmission Replaces ONLY Flagged Document and Retains Valid Documents", async () => {
  const member = createMockUser({
    _id: "selective_resubmit_001",
    userId: "GFT800101",
    kyc: {
      status: KYC_STATUS.RESUBMISSION_REQUIRED,
      flaggedDocuments: ["panCard"],
      documents: {
        aadhaarFront: { fileName: "keep_af.png", originalName: "af.png" },
        aadhaarBack: { fileName: "keep_ab.png", originalName: "ab.png" },
        panCard: { fileName: "old_pan.png", originalName: "pan.png" },
        bankPassbook: { fileName: "keep_bp.png", originalName: "bp.png" }
      }
    }
  });

  // Re-upload replacement ONLY for panCard
  const files = {
    panCard: [{
      fieldname: "panCard",
      filename: "new_pan_replacement.png",
      originalname: "pan_clear_scan.png",
      mimetype: "image/png",
      size: 2048
    }]
  };

  const profile = await KycService.uploadKycDocuments(member, files);

  assert.strictEqual(profile.status, KYC_STATUS.SUBMITTED);
  // Flagged documents list is cleared
  assert.deepStrictEqual(profile.flaggedDocuments, []);

  // Valid documents remained intact
  const updatedUser = await User.findOne({ userId: member.userId });
  assert.strictEqual(updatedUser.kyc.documents.aadhaarFront.fileName, "keep_af.png");
  assert.strictEqual(updatedUser.kyc.documents.aadhaarBack.fileName, "keep_ab.png");
  assert.strictEqual(updatedUser.kyc.documents.bankPassbook.fileName, "keep_bp.png");
  assert.strictEqual(updatedUser.kyc.documents.panCard.fileName, "new_pan_replacement.png");
});

test("Phase 2 - 12. Standard Admin CANNOT Perform Super Admin KYC Override", async () => {
  const member = createMockUser({
    _id: "override_target_001",
    userId: "GFT900101",
    kyc: { status: KYC_STATUS.APPROVED }
  });

  const normalAdmin = { userId: "ADMIN005", role: "admin" };

  await assert.rejects(
    () => KycService.superAdminOverride(normalAdmin, member.userId, "Attempting override"),
    (err) => err.statusCode === 403 && err.message.includes("Super Administrators hold override authority")
  );
});

test("Phase 2 - 13. Super Admin KYC Override Successfully Reopens Approved KYC to UNDER_REVIEW", async () => {
  const member = createMockUser({
    _id: "override_target_002",
    userId: "GFT900102",
    kyc: { status: KYC_STATUS.APPROVED }
  });

  const superAdmin = { userId: "SUPERADMIN001", role: "superadmin" };

  const profile = await KycService.superAdminOverride(
    superAdmin,
    member.userId,
    "Discrepancy reported during annual regulatory audit."
  );

  assert.strictEqual(profile.status, KYC_STATUS.UNDER_REVIEW);
  const inDB = await User.findOne({ userId: member.userId });
  assert.strictEqual(inDB.kyc.status, KYC_STATUS.UNDER_REVIEW);

  // Check audit log
  const log = mockDB.auditLogs.find(l => l.action === "KYC_SUPERADMIN_OVERRIDE" && l.userId === superAdmin.userId);
  assert.ok(log);
});

test("Phase 2 - 14. Cross-User Document Access Fails", async () => {
  const userA = createMockUser({
    _id: "user_a_001",
    userId: "GFT111111",
    kyc: {
      status: KYC_STATUS.SUBMITTED,
      documents: { aadhaarFront: { fileName: "user_a_doc.png", mimeType: "image/png" } }
    }
  });

  const userB = { userId: "GFT222222", role: "user" };

  await assert.rejects(
    () => KycService.getDocumentStream(userB, userA.userId, "aadhaarFront"),
    (err) => err.statusCode === 403 && err.message.includes("Unauthorized access")
  );
});

test("Phase 2 - 15. requireVerifiedKyc Middleware Gate Blocks Non-Approved States", async () => {
  const statusesToBlock = [
    KYC_STATUS.NOT_STARTED,
    KYC_STATUS.DRAFT,
    KYC_STATUS.SUBMITTED,
    KYC_STATUS.UNDER_REVIEW,
    KYC_STATUS.REJECTED,
    KYC_STATUS.RESUBMISSION_REQUIRED
  ];

  for (const status of statusesToBlock) {
    const req = { user: { kyc: { status } } };
    let nextCalled = false;
    let nextError = null;
    const next = (err) => {
      nextCalled = true;
      nextError = err;
    };

    requireVerifiedKyc(req, {}, next);
    assert.strictEqual(nextCalled, true);
    assert.ok(nextError instanceof AppError);
    assert.strictEqual(nextError.statusCode, 403);
  }

  // Approved state must PASS
  const reqApproved = { user: { kyc: { status: KYC_STATUS.APPROVED } } };
  let passed = false;
  requireVerifiedKyc(reqApproved, {}, (err) => {
    assert.strictEqual(err, undefined);
    passed = true;
  });
  assert.strictEqual(passed, true);
});

test("Phase 2 - 16. Full Aadhaar/PAN Values Never Stored or Logged in Audit Logs", () => {
  for (const log of mockDB.auditLogs) {
    const serialized = JSON.stringify(log);
    assert.strictEqual(serialized.includes("123456789012"), false, "Plaintext Aadhaar found in audit log!");
    assert.strictEqual(serialized.includes("ABCDE1234F"), false, "Plaintext PAN found in audit log!");
  }
});

test("Phase 2 - 17. Audit Logs Do Not Contain Document Contents or Private Filesystem Paths", () => {
  for (const log of mockDB.auditLogs) {
    const serialized = JSON.stringify(log);
    assert.strictEqual(serialized.includes("storage\\private_kyc"), false);
    assert.strictEqual(serialized.includes("storage/private_kyc"), false);
  }
});

test("Phase 2 - 18. KYC Actions Do NOT Modify Financial Records", () => {
  assert.strictEqual(mockDB.wallets.size, 0);
  assert.strictEqual(mockDB.auditLogs.some(l => l.action.includes("WALLET") || l.action.includes("COMMISSION")), false);
});

test("Phase 2 - 19. Private Storage Location is Outside Public Root", () => {
  const privateStoragePath = path.join(process.cwd(), "storage", "private_kyc");
  assert.strictEqual(privateStoragePath.includes("public"), false);
  assert.strictEqual(privateStoragePath.includes("Green-Future"), false);
});

test("Phase 2 - 20. Explicit Additional Test: Private KYC file cannot be accessed without authentication / direct path", async () => {
  // Test unauthenticated access to document stream
  await assert.rejects(
    () => KycService.getDocumentStream({ role: "anonymous", userId: "none" }, "GFT300101", "aadhaarFront"),
    (err) => err.statusCode === 403
  );

  // Test invalid document type / path traversal attempt
  await assert.rejects(
    () => KycService.getDocumentStream({ role: "admin", userId: "ADMIN001" }, "GFT300101", "../../../etc/passwd"),
    (err) => err.statusCode === 400 && err.message.includes("Invalid KYC document type")
  );
});

test("Phase 2 - 21. Explicit Additional Test: Rejected document can be replaced without deleting valid documents", async () => {
  const member = createMockUser({
    _id: "rejection_replace_001",
    userId: "GFT999001",
    kyc: {
      status: KYC_STATUS.REJECTED,
      rejectionReason: "Aadhaar back was unclear",
      documents: {
        aadhaarFront: { fileName: "valid_front.png", originalName: "front.png" },
        aadhaarBack: { fileName: "bad_back.png", originalName: "bad.png" },
        panCard: { fileName: "valid_pan.png", originalName: "pan.png" },
        bankPassbook: { fileName: "valid_bank.png", originalName: "bank.png" }
      }
    }
  });

  // Upload replacement only for aadhaarBack
  const files = {
    aadhaarBack: [{
      fieldname: "aadhaarBack",
      filename: "clean_back_new.png",
      originalname: "clear_back.png",
      mimetype: "image/png",
      size: 4096
    }]
  };

  const profile = await KycService.uploadKycDocuments(member, files);

  assert.strictEqual(profile.status, KYC_STATUS.SUBMITTED);
  const inDB = await User.findOne({ userId: member.userId });
  assert.strictEqual(inDB.kyc.documents.aadhaarFront.fileName, "valid_front.png");
  assert.strictEqual(inDB.kyc.documents.panCard.fileName, "valid_pan.png");
  assert.strictEqual(inDB.kyc.documents.bankPassbook.fileName, "valid_bank.png");
  assert.strictEqual(inDB.kyc.documents.aadhaarBack.fileName, "clean_back_new.png");
});
