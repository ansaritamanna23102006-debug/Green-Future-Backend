import express from "express";
import {
  getProfile,
  updateProfile,
  updateNominee,
  updateBankDetails,
  updateCryptoWallet,
  submitKyc,
  createUserTicket,
  getUserTickets,
} from "../controllers/userController.js";
import { protect } from "../middlewares/auth.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

router.use(protect);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.put("/nominee", updateNominee);
router.put("/bank-details", updateBankDetails);
router.put("/crypto-wallet", updateCryptoWallet);

// Support tickets routes for users
router.post("/tickets", createUserTicket);
router.get("/tickets", getUserTickets);

// Multi-file upload for KYC documents
router.post(
  "/kyc",
  upload.fields([
    { name: "aadhaarFront", maxCount: 1 },
    { name: "aadhaarBack", maxCount: 1 },
    { name: "panCard", maxCount: 1 },
    { name: "bankPassbook", maxCount: 1 },
  ]),
  submitKyc
);

export default router;
