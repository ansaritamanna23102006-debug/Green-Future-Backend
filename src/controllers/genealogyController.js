import GenealogyService from "../services/genealogyService.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

export const getDownlineTree = async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.userId;
    const maxDepth = parseInt(req.query.depth || "4");

    // Make sure users can only see their own downline unless they are admin
    if (req.user.role === "user" && req.user.userId !== userId) {
      // Validate that target user exists in request user's downline tree
      const rootNode = await GenealogyService.getDownline(req.user.userId, 15);
      const isDownline = (node, searchId) => {
        if (!node) return false;
        if (node.userId === searchId) return true;
        return isDownline(node.left, searchId) || isDownline(node.right, searchId);
      };
      if (!isDownline(rootNode, userId)) {
        throw new AppError("You do not have permission to view this user's genealogy tree", 403);
      }
    }

    const tree = await GenealogyService.getDownline(userId, maxDepth);
    return successResponse(res, tree, "Genealogy tree fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getTreeStats = async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.userId;
    
    if (req.user.role === "user" && req.user.userId !== userId) {
      throw new AppError("Access denied", 403);
    }

    const stats = await GenealogyService.getTreeStats(userId);
    return successResponse(res, stats, "Tree statistics fetched successfully");
  } catch (error) {
    next(error);
  }
};
