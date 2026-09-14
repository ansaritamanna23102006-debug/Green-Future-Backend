import express from "express";
import {
  getBinaryTree,
  getSponsorTree,
  getDirectReferrals,
  getSponsorInfo,
  getTreeStats,
  getIntegrityReport,
} from "../controllers/genealogyController.js";
import { protect, restrictTo } from "../middlewares/auth.js";

const router = express.Router();

router.use(protect);

// Member-facing authorized endpoints
router.get("/binary-tree", getBinaryTree);
router.get("/tree", getBinaryTree); // Backward compatibility alias
router.get("/sponsor-tree", getSponsorTree);
router.get("/direct-referrals", getDirectReferrals);
router.get("/sponsor-info", getSponsorInfo);
router.get("/stats", getTreeStats);

// Admin / Super Admin inspection endpoint
router.get("/integrity", restrictTo("admin", "superadmin"), getIntegrityReport);

export default router;
