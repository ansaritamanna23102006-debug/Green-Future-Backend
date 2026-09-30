/**
 * Green Future Tech (GFT) — Authentication Routes
 * Phase 1: Production Authentication & Onboarding Router
 */

import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  refresh,
  forgotPassword,
  resetPassword,
  validateSponsor,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  logout,
} from "../controllers/authController.js";
import {
  registerValidator,
  loginValidator,
  validateSponsorValidator,
  sendOtpValidator,
  verifyOtpValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
} from "../validators/authValidator.js";

const router = express.Router();

// Specific rate limiter for OTP requests (max 5 per 15 minutes per IP)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: "fail",
    message: "Too many verification code requests from this IP. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Specific rate limiter for login attempts (max 15 failed attempts per 15 minutes per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    status: "fail",
    message: "Too many login attempts from this IP. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Specific rate limiter for account registration (max 10 registrations per hour per IP)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    status: "fail",
    message: "Registration limit exceeded from this IP. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Specific rate limiter for password reset operations (max 10 per 15 minutes per IP)
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: "fail",
    message: "Too many password reset requests from this IP. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 1. Sponsor Validation
router.post("/validate-sponsor", validateSponsorValidator, validateSponsor);

// 2. Registration OTP Pipeline
router.post("/send-registration-otp", otpLimiter, sendOtpValidator, sendRegistrationOtp);
router.post("/verify-registration-otp", verifyOtpValidator, verifyRegistrationOtp);

// 3. Account Registration & Login
router.post("/register", registerLimiter, registerValidator, register);
router.post("/login", loginLimiter, loginValidator, login);
router.post("/logout", logout);

// 4. Token Refresh
router.post("/refresh-token", refresh);

// 5. Password Reset Pipeline
router.post("/forgot-password", otpLimiter, forgotPasswordValidator, forgotPassword);
router.post("/reset-password", resetLimiter, resetPasswordValidator, resetPassword);

export default router;
