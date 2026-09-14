import express from "express";
import {
  getIncomeRules,
  getMemberEligibility,
  getIncomePreview,
} from "../controllers/incomeController.js";
import { protect } from "../middlewares/auth.js";

const router = express.Router();

// Public-safe read-only business rule configuration
router.get("/rules", getIncomeRules);

// Protected member diagnostics
router.use(protect);
router.get("/eligibility", getMemberEligibility);
router.get("/preview", getIncomePreview);

export default router;


