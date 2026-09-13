/**
 * Green Future Tech (GFT) — Authentication Request Validators
 * Phase 1: Server-side validation rules for authentication & onboarding
 */

import { body } from "express-validator";
import { validate } from "./index.js";

export const validateSponsorValidator = [
  body("sponsorId")
    .trim()
    .notEmpty()
    .withMessage("Sponsor ID is required"),
  validate,
];

export const sendOtpValidator = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("mobile")
    .trim()
    .notEmpty()
    .withMessage("Mobile number is required")
    .isLength({ min: 10, max: 15 })
    .withMessage("Please enter a valid mobile number"),
  validate,
];

export const verifyOtpValidator = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("otp")
    .trim()
    .notEmpty()
    .withMessage("Verification code is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("Verification code must be exactly 6 digits"),
  validate,
];

export const registerValidator = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2 })
    .withMessage("Full name must be at least 2 characters"),
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("mobile")
    .trim()
    .notEmpty()
    .withMessage("Mobile number is required")
    .isLength({ min: 10, max: 15 })
    .withMessage("Please enter a valid mobile number"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long"),
  body("sponsorId")
    .trim()
    .notEmpty()
    .withMessage("Sponsor ID is required"),
  body("verificationToken")
    .trim()
    .notEmpty()
    .withMessage("Registration verification token is required. Please verify OTP first."),
  validate,
];

export const loginValidator = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email or User ID is required"),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
  validate,
];

export const forgotPasswordValidator = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  validate,
];

export const resetPasswordValidator = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("otp")
    .trim()
    .notEmpty()
    .withMessage("Verification code is required"),
  body("newPassword")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters long"),
  validate,
];
