/**
 * Green Future Tech (GFT) — Registration OTP Model
 * Phase 1: Temporary registration session collection.
 * 
 * Prevents creation of partial or unverified user accounts in the main User collection.
 * Documents automatically expire after 30 minutes via MongoDB TTL index.
 */

import mongoose from "mongoose";

const registrationOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    verificationToken: {
      type: String,
      default: null,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: automatically remove documents 30 minutes after creation
registrationOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

const RegistrationOtp = mongoose.model("RegistrationOtp", registrationOtpSchema);
export default RegistrationOtp;
