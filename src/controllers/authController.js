/**
 * Green Future Tech (GFT) — Authentication Controller
 * Phase 1: Controller layer for Authentication & Onboarding
 */

import AuthService from "../services/authService.js";
import { successResponse } from "../utils/response.js";

export const validateSponsor = async (req, res, next) => {
  try {
    const { sponsorId } = req.body;
    const currentUserId = req.user ? req.user.userId : null;
    const result = await AuthService.validateSponsor(sponsorId, currentUserId);
    return successResponse(res, result, "Sponsor validated successfully", 200);
  } catch (error) {
    next(error);
  }
};

export const sendRegistrationOtp = async (req, res, next) => {
  try {
    const { email, mobile } = req.body;
    const result = await AuthService.sendRegistrationOtp(email, mobile);
    return successResponse(res, result, "Verification code dispatched successfully", 200);
  } catch (error) {
    next(error);
  }
};

export const verifyRegistrationOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const result = await AuthService.verifyRegistrationOtp(email, otp);
    return successResponse(res, result, "Verification code confirmed", 200);
  } catch (error) {
    next(error);
  }
};

export const register = async (req, res, next) => {
  try {
    const result = await AuthService.register(req.body);
    return successResponse(res, result, "Account registered successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    const result = await AuthService.login(email, password, reqInfo);
    return successResponse(res, result, "Logged in successfully", 200);
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const reqInfo = {
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    const result = await AuthService.refreshAccessToken(refreshToken, reqInfo);
    return successResponse(res, result, "Access token refreshed successfully", 200);
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await AuthService.forgotPassword(email);
    return successResponse(res, result, result.message, 200);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await AuthService.resetPassword(email, otp, newPassword);
    return successResponse(res, result, result.message, 200);
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    const userId = req.user ? req.user._id : null;
    const result = await AuthService.logout(userId, refreshToken);
    return successResponse(res, result, "Logged out successfully", 200);
  } catch (error) {
    next(error);
  }
};
