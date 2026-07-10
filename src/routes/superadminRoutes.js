
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

router.get("/settings", getSettings);
router.put("/settings", updateSettings);

router.post("/admins", createAdminUser);
router.get("/admins", getAdmins);

router.get("/audit-logs", getAuditLogs);
router.get("/system-logs", getSystemLogFiles);

router.post("/trigger-payouts", triggerBinaryMatchingCalculation);

export default router;
