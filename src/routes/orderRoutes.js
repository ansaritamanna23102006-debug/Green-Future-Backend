/**
 * Green Future Tech (GFT) — Order & Payment Routes
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Record
 */

import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  initiatePayment,
  verifyPayment,
  getAdminOrderQueue,
} from "../controllers/orderController.js";
import { protect, restrictTo } from "../middlewares/auth.js";

const router = express.Router();

router.use(protect);

router.post("/", createOrder);
router.get("/", getMyOrders);
router.get("/queue", restrictTo("admin", "superadmin"), getAdminOrderQueue);
router.get("/:orderId", getOrderById);
router.post("/:orderId/pay", initiatePayment);
router.post("/verify-payment", verifyPayment);

export default router;
