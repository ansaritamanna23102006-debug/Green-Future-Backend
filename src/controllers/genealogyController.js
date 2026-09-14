/**
 * Genealogy Controller
 * Phase 5: Genealogy & Referral Network Foundation
 */

import GenealogyService from "../services/genealogyService.js";
import User from "../models/User.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";
import AuditLog from "../models/AuditLog.js";
import { GENEALOGY_AUDIT_ACTIONS } from "../utils/rules/genealogyConstants.js";

/**
 * 1. GET /api/v1/genealogy/binary-tree
 * Retrieves privacy-safe, depth-clamped binary placement tree.
 */
export const getBinaryTree = async (req, res, next) => {
  try {
    const targetUserId = (req.query.userId || req.user.userId).trim().toUpperCase();
    const depth = req.query.depth;

    // RBAC: Standard user can only view their own tree or their downline descendants
    if (req.user.role === "user" && req.user.userId !== targetUserId) {
      const isDownline = await GenealogyService.isBinaryDownline(req.user.userId, targetUserId);
      if (!isDownline) {
        await AuditLog.create({
          userId: req.user.userId,
          action: GENEALOGY_AUDIT_ACTIONS.UNAUTHORIZED_TREE_ACCESS,
          ipAddress: req.ip || "",
          userAgent: req.headers["user-agent"] || "",
          details: `Unauthorized binary tree access attempt for target user ${targetUserId}.`,
        });
        throw new AppError("You do not have permission to view this user's genealogy tree", 403);
      }
    }

    const tree = await GenealogyService.getBinaryTree(targetUserId, depth);
    return successResponse(res, tree, "Binary tree fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 2. GET /api/v1/genealogy/sponsor-tree
 * Retrieves privacy-safe, depth-clamped unilevel direct referral tree.
 */
export const getSponsorTree = async (req, res, next) => {
  try {
    const targetUserId = (req.query.userId || req.user.userId).trim().toUpperCase();
    const depth = req.query.depth;

    if (req.user.role === "user" && req.user.userId !== targetUserId) {
      const isDownline = await GenealogyService.isSponsorDownline(req.user.userId, targetUserId);
      if (!isDownline) {
        await AuditLog.create({
          userId: req.user.userId,
          action: GENEALOGY_AUDIT_ACTIONS.UNAUTHORIZED_TREE_ACCESS,
          ipAddress: req.ip || "",
          userAgent: req.headers["user-agent"] || "",
          details: `Unauthorized sponsor tree access attempt for target user ${targetUserId}.`,
        });
        throw new AppError("You do not have permission to view this user's sponsor tree", 403);
      }
    }

    const tree = await GenealogyService.getSponsorTree(targetUserId, depth);
    return successResponse(res, tree, "Sponsor tree fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 3. GET /api/v1/genealogy/direct-referrals
 * Retrieves paginated, sanitized list of direct enrollees.
 */
export const getDirectReferrals = async (req, res, next) => {
  try {
    const targetUserId = (req.query.userId || req.user.userId).trim().toUpperCase();

    if (req.user.role === "user" && req.user.userId !== targetUserId) {
      throw new AppError("You can only view your own direct referrals", 403);
    }

    const result = await GenealogyService.getDirectReferrals(targetUserId, {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });

    return successResponse(res, result, "Direct referrals fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 4. GET /api/v1/genealogy/sponsor-info
 * Retrieves authenticated user's direct sponsor credentials safely.
 */
export const getSponsorInfo = async (req, res, next) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) {
      throw new AppError("User record not found", 404);
    }

    const sponsorId = user.sponsorId || "none";
    if (sponsorId === "none" || sponsorId === "ROOT") {
      return successResponse(res, {
        sponsorId,
        sponsorName: user.sponsorName || "System Administration",
        rank: "Platform",
        status: "active",
        joiningDate: null,
      }, "Sponsor information fetched successfully");
    }

    const sponsor = await User.findOne({ userId: sponsorId });
    if (!sponsor) {
      return successResponse(res, {
        sponsorId,
        sponsorName: user.sponsorName || "Unknown Sponsor",
        rank: "none",
        status: "inactive",
        joiningDate: null,
      }, "Sponsor information fetched successfully");
    }

    return successResponse(res, {
      sponsorId: sponsor.userId,
      sponsorName: sponsor.name,
      rank: sponsor.rank || "none",
      status: sponsor.status || "inactive",
      joiningDate: sponsor.createdAt ? sponsor.createdAt.toISOString() : null,
    }, "Sponsor information fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 5. GET /api/v1/genealogy/stats
 * Retrieves tree statistics (left count, right count, direct count).
 */
export const getTreeStats = async (req, res, next) => {
  try {
    const targetUserId = (req.query.userId || req.user.userId).trim().toUpperCase();

    if (req.user.role === "user" && req.user.userId !== targetUserId) {
      const isDownline = await GenealogyService.isBinaryDownline(req.user.userId, targetUserId);
      if (!isDownline) {
        throw new AppError("Access denied to tree statistics", 403);
      }
    }

    const stats = await GenealogyService.getTreeStats(targetUserId);
    return successResponse(res, stats, "Tree statistics fetched successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 6. GET /api/v1/genealogy/integrity
 * Admin-only read-only structural integrity diagnostics.
 */
export const getIntegrityReport = async (req, res, next) => {
  try {
    const targetUserId = req.query.userId ? req.query.userId.trim().toUpperCase() : null;
    const report = await GenealogyService.validateIntegrity(targetUserId);
    return successResponse(res, report, "Genealogy integrity diagnostics completed");
  } catch (error) {
    next(error);
  }
};

// Backward-compatibility alias
export const getDownlineTree = getBinaryTree;
