import express from "express";
import withdrawalController from "../controllers/withdrawalController.js";
import { protect, restrictTo, requireVerifiedKyc } from "../middlewares/auth.js";

const router = express.Router();

// All withdrawal endpoints require valid authentication
router.use(protect);

// ==========================================
// MEMBER ROUTES
// ==========================================

// Create withdrawal (Protected by KYC verification middleware + service-level check)
router.post("/", requireVerifiedKyc, withdrawalController.requestWithdrawal);

// List authenticated member's withdrawals
router.get("/", withdrawalController.getMyWithdrawals);

// Single withdrawal details (accessible by owner or admin)
router.get("/:id", withdrawalController.getWithdrawalById);

// ==========================================
// ADMIN / SUPER ADMIN RBAC ROUTES
// ==========================================

// List all withdrawals with filters
router.get("/admin/all", restrictTo("admin", "superadmin"), withdrawalController.getAdminWithdrawals);

// Start review: REQUESTED -> UNDER_REVIEW
router.post("/admin/:id/review", restrictTo("admin", "superadmin"), withdrawalController.startReview);

// Approve: UNDER_REVIEW -> APPROVED
router.post("/admin/:id/approve", restrictTo("admin", "superadmin"), withdrawalController.approveWithdrawal);

// Reject: REQUESTED or UNDER_REVIEW -> REJECTED
router.post("/admin/:id/reject", restrictTo("admin", "superadmin"), withdrawalController.rejectWithdrawal);

// Process payout: APPROVED -> PROCESSING -> COMPLETED (or FAILED)
router.post("/admin/:id/process", restrictTo("admin", "superadmin"), withdrawalController.processPayout);

export default router;
