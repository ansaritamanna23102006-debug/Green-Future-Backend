
import express from "express";
import {
  getSettings,
  updateSettings,
  createAdminUser,
  getAdmins,
  getAuditLogs,
  getSystemLogFiles,
  triggerBinaryMatchingCalculation,
} from "../controllers/superadminController.js";
import { protect, restrictTo } from "../middlewares/auth.js";

const router = express.Router();

router.use(protect);
router.use(restrictTo("superadmin"));

import { superAdminKycOverride } from "../controllers/kycController.js";

router.get("/settings", getSettings);
router.put("/settings", updateSettings);

router.post("/admins", createAdminUser);
router.get("/admins", getAdmins);

router.get("/audit-logs", getAuditLogs);
router.get("/system-logs", getSystemLogFiles);

// Phase 2 Super Admin KYC Authority
router.post("/kyc/override", superAdminKycOverride);

router.post("/trigger-payouts", triggerBinaryMatchingCalculation);

export default router;
