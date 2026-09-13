import express from "express";
import {
  getAllUsers,
  updateUserStatus,
  reviewKyc,
  getAllWithdrawals,
  updateWithdrawalStatus,
  getSupportTickets,
  replySupportTicket,
  closeSupportTicket,
  createAnnouncement,
  createOffer,
  uploadCompanyDocument,
  editUser,
  deleteUser,
} from "../controllers/adminController.js";
import { getTokenSupplyMetrics } from "../controllers/superadminController.js";
import { protect, restrictTo } from "../middlewares/auth.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

router.use(protect);
router.use(restrictTo("admin", "superadmin"));

import {
  getKycQueue,
  getMemberKycDetails,
  previewCandidateDocument,
  startKycReview,
  submitKycDecision,
} from "../controllers/kycController.js";

router.get("/users", getAllUsers);
router.put("/users/status", updateUserStatus);
router.put("/users/:userId", editUser);
router.delete("/users/:userId", deleteUser);

// Phase 2 Admin KYC Management
router.get("/kyc/queue", getKycQueue);
router.get("/kyc/:userId", getMemberKycDetails);
router.get("/kyc/:userId/document/:docType", previewCandidateDocument);
router.post("/kyc/start-review", startKycReview);
router.post("/kyc/review", submitKycDecision);

router.get("/withdrawals", getAllWithdrawals);
router.post("/withdrawals/review", updateWithdrawalStatus);
router.get("/token-supply", getTokenSupplyMetrics);

router.get("/tickets", getSupportTickets);
router.post("/tickets/reply", replySupportTicket);
router.post("/tickets/close", closeSupportTicket);

router.post("/announcements", createAnnouncement);
router.post("/offers", upload.single("banner"), createOffer);
router.post("/documents", upload.single("file"), uploadCompanyDocument);

export default router;
