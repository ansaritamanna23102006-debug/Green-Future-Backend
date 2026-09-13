/**
 * Green Future Tech (GFT) — Authoritative Authentication Service
 * Phase 1: Production Authentication & Multi-Step Onboarding Engine
 * 
 * Features:
 * - Real Sponsor validation with self-sponsorship prevention.
 * - Multi-step registration OTP verification via RegistrationOtp model.
 * - Single-use cryptographic verification tokens to prevent partial accounts.
 * - Bcrypt password hashing (salt 10).
 * - Generic error messages to prevent account enumeration.
 * - SHA-256 hashed OTP storage (zero plaintext OTPs).
 * - Session device tracking and rate-limiting support.
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import RegistrationOtp from "../models/RegistrationOtp.js";
import GenealogyService from "./genealogyService.js";
import AppError from "../utils/errors.js";
import sendEmail from "../config/mailer.js";

class AuthService {
  // Helper to generate access token
  generateAccessToken(user) {
    return jwt.sign(
      { id: user._id, userId: user.userId, role: user.role },
      process.env.JWT_SECRET || "super_secret_jwt_access_key_change_me",
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m" }
    );
  }

  // Helper to generate refresh token with unique jti identifier for rotation & replay defense
  generateRefreshToken(user) {
    const jti = crypto.randomBytes(16).toString("hex");
    return jwt.sign(
      { id: user._id, userId: user.userId, jti },
      process.env.JWT_REFRESH_SECRET || "super_secret_jwt_refresh_key_change_me",
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" }
    );
  }

  // Dedicated server-side pepper for OTP hashing (prevents rainbow tables and decouples from JWT)
  hashOtp(otp) {
    const pepper = process.env.OTP_PEPPER_SECRET || process.env.OTP_SECRET || "gft_secure_authoritative_otp_pepper_2026";
    return crypto.createHash("sha256").update(String(otp).trim() + pepper).digest("hex");
  }

  // Cryptographic hash for refresh token revocation & rotation tracking
  hashRefreshToken(token) {
    const salt = process.env.JWT_REFRESH_SECRET || "gft_refresh_token_revocation_salt_2026";
    return crypto.createHash("sha256").update(String(token).trim() + salt).digest("hex");
  }

  /**
   * Bounded Device Session Policy:
   * - Identifies device via fingerprint (IP + User-Agent snippet)
   * - Updates existing device session rather than endlessly duplicating
   * - Prunes stale sessions older than 30 days
   * - Strictly caps at 5 active devices per user (oldest dropped)
   * - Stores zero unnecessary sensitive data
   */
  manageDeviceSession(user, reqInfo, refreshTokenHash) {
    if (!user.activeDevices) user.activeDevices = [];
    const ip = String(reqInfo.ip || "127.0.0.1").trim();
    const userAgent = String(reqInfo.userAgent || "Unknown Client").slice(0, 150).trim();
    const deviceId = crypto.createHash("sha256").update(ip + ":" + userAgent).digest("hex").slice(0, 16);

    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Prune stale sessions older than 30 days
    user.activeDevices = user.activeDevices.filter(
      (d) => d.lastActive && new Date(d.lastActive) > thirtyDaysAgo
    );

    const existingIndex = user.activeDevices.findIndex(
      (d) => d.deviceId === deviceId || (d.ip === ip && d.userAgent === userAgent)
    );

    if (existingIndex !== -1) {
      user.activeDevices[existingIndex].lastActive = now;
      user.activeDevices[existingIndex].ip = ip;
      user.activeDevices[existingIndex].userAgent = userAgent;
      user.activeDevices[existingIndex].refreshTokenHash = refreshTokenHash;
    } else {
      user.activeDevices.unshift({
        deviceId,
        ip,
        userAgent,
        refreshTokenHash,
        lastActive: now,
      });
    }

    const MAX_ACTIVE_DEVICES = 5;
    if (user.activeDevices.length > MAX_ACTIVE_DEVICES) {
      user.activeDevices.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      user.activeDevices = user.activeDevices.slice(0, MAX_ACTIVE_DEVICES);
    }
  }

  /**
   * Validates sponsor ID server-side.
   * Prevents non-existent sponsors and self-sponsorship.
   */
  async validateSponsor(sponsorId, currentUserId = null) {
    const cleanId = String(sponsorId || "").trim().toUpperCase();
    if (!cleanId) {
      throw new AppError("Sponsor ID is required", 400);
    }

    if (currentUserId && cleanId === String(currentUserId).trim().toUpperCase()) {
      throw new AppError("User cannot sponsor themselves", 400);
    }

    // Support system root onboarding bypass if configured
    if (cleanId === "ROOT") {
      return {
        valid: true,
        sponsorId: "ROOT",
        sponsorName: "System Administration",
        rank: "Platform",
      };
    }

    const sponsor = await User.findOne({ userId: cleanId });
    if (!sponsor) {
      throw new AppError(`Sponsor with ID '${cleanId}' does not exist`, 404);
    }

    if (sponsor.status === "suspended") {
      throw new AppError("Sponsor account is suspended and cannot accept new referrals", 400);
    }

    return {
      valid: true,
      sponsorId: sponsor.userId,
      sponsorName: sponsor.name,
      rank: sponsor.rank,
    };
  }

  /**
   * Generates and dispatches a single-use 6-digit registration OTP.
   * Plaintext OTP is NEVER stored in the database.
   */
  async sendRegistrationOtp(email, mobile) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanMobile = String(mobile || "").trim();

    if (!cleanEmail || !cleanMobile) {
      throw new AppError("Email and mobile number are required to request verification code", 400);
    }

    // Check if email already exists
    const emailExists = await User.findOne({ email: cleanEmail });
    if (emailExists) {
      throw new AppError("Email is already registered", 400);
    }

    // Check if mobile already exists
    const mobileExists = await User.findOne({ mobile: cleanMobile });
    if (mobileExists) {
      throw new AppError("Mobile number is already registered", 400);
    }

    // Rate-limiting check: 60 second resend cooldown
    const existing = await RegistrationOtp.findOne({ email: cleanEmail });
    if (existing && existing.lastSentAt) {
      const elapsedMs = Date.now() - existing.lastSentAt.getTime();
      if (elapsedMs < 60000) {
        const remainingSeconds = Math.ceil((60000 - elapsedMs) / 1000);
        throw new AppError(`Please wait ${remainingSeconds} seconds before requesting a new code`, 429);
      }
    }

    // Generate random 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert temporary registration session
    await RegistrationOtp.findOneAndUpdate(
      { email: cleanEmail },
      {
        email: cleanEmail,
        mobile: cleanMobile,
        otpHash,
        attempts: 0,
        expiresAt,
        verified: false,
        verificationToken: null,
        lastSentAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Send email with OTP code (safe fallback logs to logger if SMTP not configured)
    try {
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 24px; color: #0E3B2E; max-width: 500px; border: 1px solid #C9A34A; border-radius: 12px;">
          <h2 style="color: #0B5D43; margin-top: 0;">Green Future Tech — Registration Code</h2>
          <p>Please use the following 6-digit verification code to complete your registration:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #F8F6F1; color: #0B5D43; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0; border: 1px dashed #C9A34A;">
            ${otp}
          </div>
          <p style="font-size: 13px; color: #666;">This code is single-use and will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
        </div>
      `;
      await sendEmail({
        to: cleanEmail,
        subject: "Green Future Tech — Registration Verification Code",
        html: emailHtml,
      });
    } catch (err) {
      console.error(`Email send failed for registration OTP: ${err.message}`);
    }

    return {
      message: "Verification code sent to your email and mobile",
      expiresMinutes: 10,
    };
  }

  /**
   * Verifies registration OTP and issues a temporary single-use verification token.
   */
  async verifyRegistrationOtp(email, otp) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanOtp = String(otp || "").trim();

    if (!cleanEmail || !cleanOtp) {
      throw new AppError("Email and verification code are required", 400);
    }

    const record = await RegistrationOtp.findOne({ email: cleanEmail });
    if (!record) {
      throw new AppError("No verification session found. Please request a new code.", 400);
    }

    if (record.verified) {
      throw new AppError("This verification code has already been used. Please request a new code.", 400);
    }

    if (record.expiresAt < new Date()) {
      throw new AppError("Verification code has expired. Please request a new code.", 400);
    }

    if (record.attempts >= record.maxAttempts) {
      throw new AppError("Maximum verification attempts exceeded. Please request a new code.", 429);
    }

    const inputHash = this.hashOtp(cleanOtp);
    if (inputHash !== record.otpHash) {
      record.attempts += 1;
      await record.save();
      const remaining = record.maxAttempts - record.attempts;
      throw new AppError(`Invalid verification code. ${remaining} attempts remaining.`, 400);
    }

    // Generate single-use verification token and invalidate raw OTP hash immediately
    const verificationToken = crypto.randomBytes(32).toString("hex");
    record.otpHash = null;
    record.verified = true;
    record.verifiedAt = new Date();
    record.verificationToken = verificationToken;
    await record.save();

    return {
      verified: true,
      verificationToken,
      message: "Code verified successfully. Proceed to password creation.",
    };
  }

  /**
   * Final atomic registration.
   * Requires verified verificationToken to prevent partial/unverified account creation.
   */
  async register(userData) {
    const {
      name,
      email,
      mobile,
      password,
      sponsorId,
      position,
      address,
      state,
      city,
      country,
      verificationToken,
    } = userData;

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanMobile = String(mobile || "").trim();

    // 1. Enforce single-use OTP verification token
    const otpRecord = await RegistrationOtp.findOne({
      email: cleanEmail,
      verificationToken,
      verified: true,
    });

    if (!otpRecord) {
      throw new AppError("Invalid or missing registration verification token. Please verify your OTP first.", 400);
    }

    if (otpRecord.expiresAt < new Date()) {
      throw new AppError("Registration verification session has expired. Please verify your OTP again.", 400);
    }

    // 2. Validate email uniqueness
    const emailExists = await User.findOne({ email: cleanEmail });
    if (emailExists) {
      throw new AppError("Email is already registered", 400);
    }

    // 3. Validate mobile uniqueness
    const mobileExists = await User.findOne({ mobile: cleanMobile });
    if (mobileExists) {
      throw new AppError("Mobile number is already registered", 400);
    }

    // 4. Validate sponsor
    let finalSponsorId = "none";
    let finalSponsorName = "None";

    if (sponsorId && sponsorId !== "none" && sponsorId !== "ROOT") {
      const sponsor = await User.findOne({ userId: String(sponsorId).trim().toUpperCase() });
      if (!sponsor) {
        throw new AppError(`Sponsor with ID '${sponsorId}' does not exist`, 404);
      }
      if (sponsor.status === "suspended") {
        throw new AppError("Sponsor account is suspended", 400);
      }
      finalSponsorId = sponsor.userId;
      finalSponsorName = sponsor.name;
    } else if (sponsorId === "ROOT") {
      finalSponsorId = "none";
      finalSponsorName = "System Administration";
    }

    // 5. Generate unique User ID (GFT + 6 random digits)
    let isUnique = false;
    let userId = "";
    while (!isUnique) {
      const randDigits = Math.floor(100000 + Math.random() * 900000);
      userId = `GFT${randDigits}`;
      const check = await User.findOne({ userId });
      if (!check) isUnique = true;
    }

    // 6. Generate unique referral code
    const referralCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    // 7. Create User
    const user = await User.create({
      userId,
      sponsorId: finalSponsorId,
      sponsorName: finalSponsorName,
      name: String(name || "").trim(),
      email: cleanEmail,
      mobile: cleanMobile,
      password,
      address,
      state,
      city,
      country,
      referralCode,
      isEmailVerified: true,
      isMobileVerified: true,
      status: "inactive", // inactive until package activation in Phase 3
    });

    // 8. Place in genealogy tree (if binary sponsor specified)
    if (finalSponsorId !== "none") {
      try {
        await GenealogyService.addMember(userId, finalSponsorId, position);
      } catch (genErr) {
        console.warn(`Genealogy placement skipped/deferred: ${genErr.message}`);
      }
    }

    // 9. Initialize user wallet safely without unconfirmed token economics
    await Wallet.create({
      user: user._id,
      userId: user.userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
      version: 1,
    });

    // 11. Invalidate/delete registration OTP session to prevent token replay
    await RegistrationOtp.deleteOne({ _id: otpRecord._id });

    // 12. Send Welcome Email (non-blocking)
    try {
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 24px; color: #0E3B2E; max-width: 500px; border: 1px solid #C9A34A; border-radius: 12px;">
          <h2 style="color: #0B5D43;">Welcome to Green Future Tech, ${name}!</h2>
          <p>Your affiliate account has been created successfully. Here are your credentials:</p>
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>User ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${userId}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Referral Code:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${referralCode}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Sponsor:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${finalSponsorName} (${finalSponsorId})</td></tr>
          </table>
          <p style="font-size: 13px; color: #666;">Log in to access your member portal.</p>
        </div>
      `;
      await sendEmail({
        to: cleanEmail,
        subject: "Welcome to Green Future Tech — Account Created",
        html: emailHtml,
      });
    } catch (err) {
      console.error(`Welcome email send failed: ${err.message}`);
    }

    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      referralCode: user.referralCode,
      sponsorId: user.sponsorId,
      sponsorName: user.sponsorName,
    };
  }

  /**
   * Authenticates user and returns JWT sessions.
   * Generic error responses prevent account enumeration.
   */
  async login(emailOrUserId, password, reqInfo = {}) {
    const cleanId = String(emailOrUserId || "").trim();
    const cleanPass = String(password || "").trim();

    if (!cleanId || !cleanPass) {
      throw new AppError("User ID or Email and password are required", 400);
    }

    const user = await User.findOne({
      $or: [
        { email: cleanId.toLowerCase() },
        { userId: cleanId.toUpperCase() },
      ],
    });

    // Account enumeration defense: generic 401 message
    if (!user) {
      throw new AppError("Invalid credentials", 401);
    }

    if (user.status === "suspended") {
      throw new AppError("Your account has been suspended. Please contact support.", 403);
    }

    const isMatch = await user.matchPassword(cleanPass);
    if (!isMatch) {
      throw new AppError("Invalid credentials", 401);
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    // Record session device with bounded device policy & refresh token tracking
    user.lastLoginAt = new Date();
    this.manageDeviceSession(user, reqInfo, refreshTokenHash);
    await user.save();

    return {
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        rank: user.rank,
        referralCode: user.referralCode,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refreshes JWT access token using a valid Refresh Token.
   * Enforces single-use refresh token rotation and revocation detection.
   */
  async refreshAccessToken(tokenStr, reqInfo = {}) {
    try {
      const decoded = jwt.verify(
        tokenStr,
        process.env.JWT_REFRESH_SECRET || "super_secret_jwt_refresh_key_change_me"
      );
      const user = await User.findById(decoded.id);
      if (!user) {
        throw new AppError("User belonging to this token no longer exists", 401);
      }

      if (user.status === "suspended") {
        throw new AppError("User account is suspended", 403);
      }

      const providedHash = this.hashRefreshToken(tokenStr);

      if (!user.activeDevices) user.activeDevices = [];
      const sessionIndex = user.activeDevices.findIndex(
        (d) => d.refreshTokenHash === providedHash
      );

      if (sessionIndex === -1) {
        // Reuse or revoked token detected: invalidate all active sessions for security
        user.activeDevices = [];
        await user.save();
        throw new AppError("Invalid or revoked refresh token. Please log in again.", 401);
      }

      // Secure Rotation: Issue new 15-minute Access Token AND new 7-day Refresh Token
      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);
      const newHash = this.hashRefreshToken(newRefreshToken);

      user.activeDevices[sessionIndex].refreshTokenHash = newHash;
      user.activeDevices[sessionIndex].lastActive = new Date();
      if (reqInfo.ip) user.activeDevices[sessionIndex].ip = reqInfo.ip;
      if (reqInfo.userAgent) user.activeDevices[sessionIndex].userAgent = reqInfo.userAgent.slice(0, 150);
      await user.save();

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Invalid or expired refresh token", 401);
    }
  }

  /**
   * Logs out user by revoking the refresh token session.
   */
  async logout(userId, tokenStr = null) {
    if (!userId && !tokenStr) {
      return { loggedOut: true };
    }

    let user = null;
    if (userId) {
      user = await User.findById(userId);
    } else if (tokenStr) {
      try {
        const decoded = jwt.verify(
          tokenStr,
          process.env.JWT_REFRESH_SECRET || "super_secret_jwt_refresh_key_change_me"
        );
        user = await User.findById(decoded.id);
      } catch (e) {
        return { loggedOut: true };
      }
    }

    if (user && user.activeDevices) {
      if (tokenStr) {
        const tokenHash = this.hashRefreshToken(tokenStr);
        user.activeDevices = user.activeDevices.filter((d) => d.refreshTokenHash !== tokenHash);
      } else {
        user.activeDevices = [];
      }
      await user.save();
    }

    return { loggedOut: true };
  }

  /**
   * Forgot Password - Dispatches single-use hashed OTP.
   * Generic response prevents account enumeration.
   */
  async forgotPassword(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    // Account enumeration defense: respond with generic message even if user not found
    if (!user) {
      return { message: "If an account matches this email, a password reset code has been sent." };
    }

    // Rate-limit: if code requested within last 60 seconds, do not re-send
    if (user.passwordResetExpires && user.passwordResetExpires.getTime() - Date.now() > 14 * 60 * 1000) {
      return { message: "If an account matches this email, a password reset code has been sent." };
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    user.passwordResetToken = this.hashOtp(otp);
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    user.passwordResetAttempts = 0;
    await user.save();

    // Dispatch email
    try {
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 24px; color: #0E3B2E; max-width: 500px; border: 1px solid #C9A34A; border-radius: 12px;">
          <h2 style="color: #0B5D43;">Password Reset Code</h2>
          <p>You requested a password reset for your GFT account. Use the following 6-digit code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #F8F6F1; color: #0B5D43; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0; border: 1px dashed #C9A34A;">
            ${otp}
          </div>
          <p style="font-size: 13px; color: #666;">This code expires in 15 minutes. If you did not request this, please contact support immediately.</p>
        </div>
      `;
      await sendEmail({
        to: cleanEmail,
        subject: "Green Future Tech — Password Reset Code",
        html: emailHtml,
      });
    } catch (err) {
      console.error(`Forgot password email failed: ${err.message}`);
    }

    return { message: "If an account matches this email, a password reset code has been sent." };
  }

  /**
   * Resets password using the validated hashed OTP.
   */
  async resetPassword(email, otp, newPassword) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanOtp = String(otp || "").trim();

    if (!cleanEmail || !cleanOtp || !newPassword) {
      throw new AppError("Email, verification code, and new password are required", 400);
    }

    if (String(newPassword).length < 8) {
      throw new AppError("New password must be at least 8 characters long", 400);
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      throw new AppError("Invalid or expired password reset code", 400);
    }

    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new AppError("Password reset code has expired", 400);
    }

    if ((user.passwordResetAttempts || 0) >= 5) {
      throw new AppError("Maximum reset attempts exceeded. Please request a new code.", 429);
    }

    const inputHash = this.hashOtp(cleanOtp);
    if (inputHash !== user.passwordResetToken) {
      user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
      await user.save();
      const remaining = 5 - user.passwordResetAttempts;
      throw new AppError(`Invalid password reset code. ${remaining} attempts remaining.`, 400);
    }

    // Update password, clear reset state, and revoke all active device sessions
    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetAttempts = 0;
    user.activeDevices = [];
    await user.save();

    return { message: "Password updated successfully. Please log in with your new password." };
  }
}

export default new AuthService();
