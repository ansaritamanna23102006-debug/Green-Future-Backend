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

router.get("/users", getAllUsers);
router.put("/users/status", updateUserStatus);
router.put("/users/:userId", editUser);
router.delete("/users/:userId", deleteUser);
router.post("/kyc/review", reviewKyc);

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
