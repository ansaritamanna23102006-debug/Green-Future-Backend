import express from "express";
import { register, login, refresh, forgotPassword, resetPassword } from "../controllers/authController.js";
import { registerValidator, loginValidator } from "../validators/authValidator.js";

const router = express.Router();

router.post("/register", registerValidator, register);
router.post("/login", loginValidator, login);
router.post("/refresh-token", refresh);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
