/**
 * Green Future Tech (GFT) — Member KYC Routes
 * Phase 2: Member compliance document submission and private preview
 */

import express from "express";
import { protect } from "../middlewares/auth.js";
import {
  getMyKycProfile,
  uploadKycDocuments,
  previewMyDocument,
} from "../controllers/kycController.js";
import {
  secureKycUpload,
  validateKycMagicBytes,
} from "../middlewares/secureKycUpload.js";

const router = express.Router();

router.use(protect);

router.get("/profile", getMyKycProfile);

router.post(
  "/upload",
  secureKycUpload.fields([
    { name: "aadhaarFront", maxCount: 1 },
    { name: "aadhaarBack", maxCount: 1 },
    { name: "panCard", maxCount: 1 },
    { name: "bankPassbook", maxCount: 1 },
  ]),
  validateKycMagicBytes,
  uploadKycDocuments
);

// Authenticated private document stream for member's own documents
router.get("/document/:docType", previewMyDocument);

export default router;
