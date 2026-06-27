import { body } from "express-validator";
import { validate } from "./index.js";

export const registerValidator = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters"),
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
    .isMobilePhone()
    .withMessage("Please enter a valid mobile number"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("sponsorId")
    .trim()
    .notEmpty()
    .withMessage("Sponsor ID is required"),
  body("position")
    .optional()
    .isIn(["left", "right", "auto", ""])
    .withMessage("Position must be either 'left', 'right', or 'auto'"),
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
