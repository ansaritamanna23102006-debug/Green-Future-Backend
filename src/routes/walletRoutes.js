import express from "express";
import {
  getWalletBalances,
  getTransactionHistory,
  buyPackage,
  transferTokens,
  requestWithdrawal,
  getWithdrawalHistory,
  getPackages,
} from "../controllers/walletController.js";
import { protect } from "../middlewares/auth.js";

const router = express.Router();

router.use(protect);

router.get("/balances", getWalletBalances);
router.get("/transactions", getTransactionHistory);
router.post("/buy-package", buyPackage);
router.post("/transfer", transferTokens);
router.post("/withdraw", requestWithdrawal);
router.get("/withdrawals", getWithdrawalHistory);
router.get("/packages", getPackages);

export default router;
