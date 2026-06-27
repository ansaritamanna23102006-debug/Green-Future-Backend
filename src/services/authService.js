import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import GenealogyService from "./genealogyService.js";
import AppError from "../utils/errors.js";
import sendEmail from "../config/mailer.js";
import crypto from "crypto";

class AuthService {
  // Helper to generate access token
  generateAccessToken(user) {
    return jwt.sign(
      { id: user._id, userId: user.userId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m" }
    );
  }

  // Helper to generate refresh token
  generateRefreshToken(user) {
    return jwt.sign(
      { id: user._id, userId: user.userId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" }
    );
  }

  /**
   * Registers a new User, places them in the Binary Genealogy tree,
   * creates their Wallet, and allocates a 100 GFT registration token bonus.
   */
  async register(userData) {
    const { name, email, mobile, password, sponsorId, position, address, state, city, country } = userData;

    // Check if email already exists
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      throw new AppError("Email is already registered", 400);
    }

    // Check if sponsor exists
    const sponsor = await User.findOne({ userId: sponsorId });
    if (!sponsor && sponsorId !== "none" && sponsorId !== "ROOT") {
      throw new AppError(`Sponsor with ID ${sponsorId} does not exist`, 404);
    }

    // Generate unique User ID (GFT + 6 random digits)
    let isUnique = false;
    let userId = "";
    while (!isUnique) {
      const randDigits = Math.floor(100000 + Math.random() * 900000);
      userId = `GFT${randDigits}`;
      const check = await User.findOne({ userId });
      if (!check) isUnique = true;
    }

    // Generate random referral code
    const referralCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    // Create User
    const user = await User.create({
      userId,
      sponsorId: sponsorId === "ROOT" ? "none" : sponsorId,
      sponsorName: sponsor ? sponsor.name : "None",
      name,
      email,
      mobile,
      password,
      address,
      state,
      city,
      country,
      referralCode,
      status: "inactive", // inactive until a package is purchased
    });

    // Place in binary genealogy tree (unless it's the root node bypass)
    if (sponsorId !== "none" && sponsorId !== "ROOT") {
      await GenealogyService.addMember(userId, sponsorId, position);
    }

    // Initialize user wallet
    const wallet = await Wallet.create({
      user: user._id,
      userId: user.userId,
      tokenWallet: 100, // 100 GFT Registration Bonus
    });

    // Log registration bonus transaction
    await Transaction.create({
      user: user._id,
      userId: user.userId,
      amount: 100,
      currency: "GFT",
      type: "credit",
      category: "registration_bonus",
      description: "Sign up registration bonus of GFT tokens",
      referenceId: "SIGNUP",
    });

    // Send Welcome Email (non-blocking)
    try {
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 20px; color: #031412;">
          <h2 style="color: #65b300;">Welcome to Green Future Tech, ${name}!</h2>
          <p>Thank you for registering. Here are your account details:</p>
          <table style="border-collapse: collapse; width: 100%; max-width: 400px; margin-bottom: 20px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #ccc;"><strong>User ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ccc;">${userId}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #ccc;"><strong>Referral Code:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ccc;">${referralCode}</td></tr>
          </table>
          <p>Verify your email and activate your node in the binary network by choosing an eco-tech package.</p>
        </div>
      `;
      await sendEmail({
        to: email,
        subject: "Welcome to Green Future Tech - Account Registration",
        html: emailHtml,
      });
    } catch (err) {
      // Log error but don't fail registration
      console.error(`Email send failed during registration: ${err.message}`);
    }

    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      referralCode: user.referralCode,
    };
  }

  /**
   * Log in user, compare password and return tokens.
   */
  async login(email, password) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("Invalid credentials", 401);
    }

    if (user.status === "suspended") {
      throw new AppError("Your account has been suspended. Please contact support.", 403);
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      throw new AppError("Invalid credentials", 401);
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refreshes JWT access token using a valid Refresh Token.
   */
  async refreshAccessToken(tokenStr) {
    try {
      const decoded = jwt.verify(tokenStr, process.env.JWT_REFRESH_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) {
        throw new AppError("User not found", 401);
      }

      if (user.status === "suspended") {
        throw new AppError("User account is suspended", 403);
      }

      const newAccessToken = this.generateAccessToken(user);
      return { accessToken: newAccessToken };
    } catch (error) {
      throw new AppError("Invalid or expired refresh token", 401);
    }
  }

  /**
   * Trigger Forgot Password - Send OTP/Reset link
   */
  async forgotPassword(email) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User with this email does not exist", 404);
    }

    // Generate random 6 digit token
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    user.passwordResetToken = token;
    user.passwordResetExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

    // Send reset email
    const emailHtml = `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Password Reset OTP</h2>
        <p>You requested a password reset. Use the following 6-digit OTP code to reset your password:</p>
        <div style="font-size: 24px; font-weight: bold; background: #f0f0f0; padding: 10px; text-align: center; max-width: 150px; margin: 10px 0;">
          ${token}
        </div>
        <p>This code expires in 15 minutes.</p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: "Green Future Tech - Password Reset OTP",
      html: emailHtml,
    });

    return { message: "Reset code sent to email" };
  }

  /**
   * Reset password using validation OTP
   */
  async resetPassword(email, otp, newPassword) {
    const user = await User.findOne({
      email,
      passwordResetToken: otp,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new AppError("Invalid reset code or code has expired", 400);
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return { message: "Password updated successfully" };
  }
}

export default new AuthService();
