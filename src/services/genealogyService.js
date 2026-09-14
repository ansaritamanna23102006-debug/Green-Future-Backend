/**
 * Green Future Tech (GFT) — Authoritative Genealogy & Network Service
 * Phase 5: Genealogy & Referral Network Foundation
 * 
 * Guarantees:
 * 1. Complete separation of Sponsor Tree (1-to-N) and Binary Placement Tree (1-to-2).
 * 2. Immutable sponsor assignment; permanent structural binary placement.
 * 3. Atomic single-document slot acquisition on standalone MongoDB with compensating rollback.
 * 4. Cycle prevention (self-parent, descendant-parent, visited-set BFS guards).
 * 5. Traversal depth clamps & privacy-safe sanitization (zero PII, zero financial metrics).
 * 6. ZERO financial side effects (zero volume increments, zero wallet/ledger changes).
 * 7. Read-only structural integrity diagnostics.
 */

import User from "../models/User.js";
import Genealogy from "../models/Genealogy.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import logger from "../config/logger.js";
import {
  PLACEMENT_POSITION,
  VALID_PLACEMENT_POSITIONS,
  GENEALOGY_TREE_LIMITS,
  GENEALOGY_AUDIT_ACTIONS,
} from "../utils/rules/genealogyConstants.js";

class GenealogyService {
  /**
   * Dedicated Privacy-Safe Sanitizer.
   * Strips all credentials, PII (phone/email), KYC, bank, wallet, and sensitive fields.
   */
  sanitizeMember(userDoc, genDoc = null) {
    if (!userDoc) return null;
    return {
      userId: userDoc.userId,
      name: userDoc.name,
      rank: userDoc.rank || "none",
      status: userDoc.status || "inactive",
      placementLeg: genDoc ? genDoc.placementLeg : userDoc.position || "",
      joiningDate: userDoc.createdAt ? userDoc.createdAt.toISOString() : null,
      activePackageName: userDoc.activePackage?.name || "None",
    };
  }

  /**
   * 1. Assigns an immutable sponsor to a user.
   * Authoritative source of truth: User.sponsorId
   */
  async assignSponsor(userId, sponsorId, reqInfo = {}) {
    const cleanUserId = String(userId || "").trim().toUpperCase();
    const cleanSponsorId = String(sponsorId || "").trim().toUpperCase();

    if (!cleanUserId) {
      throw new AppError("User ID is required", 400);
    }
    if (!cleanSponsorId) {
      throw new AppError("Sponsor ID is required", 400);
    }

    if (cleanUserId === cleanSponsorId) {
      throw new AppError("User cannot sponsor themselves", 400);
    }

    const user = await User.findOne({ userId: cleanUserId });
    if (!user) {
      throw new AppError(`User with ID '${cleanUserId}' not found`, 404);
    }

    // Sponsor immutability: If already assigned to an actual sponsor, forbid alteration
    if (user.sponsorId && user.sponsorId !== "none" && user.sponsorId !== cleanSponsorId) {
      throw new AppError("Sponsor is already assigned and cannot be modified", 409);
    }

    let finalSponsorName = "None";
    if (cleanSponsorId !== "none" && cleanSponsorId !== "ROOT") {
      const sponsor = await User.findOne({ userId: cleanSponsorId });
      if (!sponsor) {
        throw new AppError(`Sponsor with ID '${cleanSponsorId}' does not exist`, 404);
      }
      if (sponsor.status === "suspended") {
        throw new AppError("Sponsor account is suspended and cannot accept referrals", 400);
      }

      // Cycle prevention in sponsor tree: ensure cleanUserId is not in sponsor's upline
      let currentUplineId = sponsor.sponsorId;
      let depth = 0;
      const visited = new Set([cleanSponsorId]);

      while (currentUplineId && currentUplineId !== "none" && currentUplineId !== "ROOT" && depth < 50) {
        if (currentUplineId === cleanUserId) {
          await AuditLog.create({
            userId: cleanUserId,
            action: GENEALOGY_AUDIT_ACTIONS.CYCLE_DETECTED,
            ipAddress: reqInfo.ip || "",
            userAgent: reqInfo.userAgent || "",
            details: `Sponsorship cycle rejected: Target sponsor ${cleanSponsorId} is a referral downline of ${cleanUserId}.`,
          });
          throw new AppError("Sponsorship cycle detected: Sponsor is in user's downline", 400);
        }
        if (visited.has(currentUplineId)) break;
        visited.add(currentUplineId);

        const uplineUser = await User.findOne({ userId: currentUplineId });
        if (!uplineUser) break;
        currentUplineId = uplineUser.sponsorId;
        depth++;
      }

      finalSponsorName = sponsor.name;
    } else if (cleanSponsorId === "ROOT") {
      finalSponsorName = "System Administration";
    }

    user.sponsorId = cleanSponsorId;
    user.sponsorName = finalSponsorName;
    await user.save();

    return {
      userId: user.userId,
      sponsorId: user.sponsorId,
      sponsorName: user.sponsorName,
    };
  }

  /**
   * 2. Finds the next open placement slot starting from a target root node.
   * Traverses extreme left or right leg.
   */
  async findPlacement(rootId, preferredPosition = "left") {
    const cleanRootId = String(rootId || "").trim().toUpperCase();
    let position = String(preferredPosition || "left").trim().toLowerCase();

    if (!VALID_PLACEMENT_POSITIONS.includes(position)) {
      position = PLACEMENT_POSITION.LEFT;
    }

    const rootUser = await User.findOne({ userId: cleanRootId });
    if (!rootUser) {
      throw new AppError(`Root placement user '${cleanRootId}' not found`, 404);
    }

    let currentUserId = cleanRootId;
    let parentId = "";
    let found = false;
    let depth = 0;
    const visited = new Set();

    while (!found && depth < GENEALOGY_TREE_LIMITS.HARD_SAFETY_TRAVERSAL_LIMIT) {
      if (visited.has(currentUserId)) {
        throw new AppError(`Corrupted cycle detected in genealogy tree at node '${currentUserId}'`, 500);
      }
      visited.add(currentUserId);

      const currentNode = await Genealogy.findOne({ userId: currentUserId });
      if (!currentNode) {
        // Node has no genealogy entry yet (e.g. system root)
        parentId = depth === 0 ? "" : currentUserId;
        found = true;
        break;
      }

      if (position === PLACEMENT_POSITION.LEFT) {
        if (!currentNode.leftNodeId) {
          parentId = currentUserId;
          found = true;
        } else {
          currentUserId = currentNode.leftNodeId;
        }
      } else {
        if (!currentNode.rightNodeId) {
          parentId = currentUserId;
          found = true;
        } else {
          currentUserId = currentNode.rightNodeId;
        }
      }
      depth++;
    }

    if (!found) {
      throw new AppError("Maximum traversal depth exceeded while searching for placement slot", 500);
    }

    return { parentId, position };
  }

  /**
   * 3. Places a member into the binary tree atomically.
   * Authoritative source of truth: Genealogy collection.
   */
  async placeMember(userId, parentId, position, sponsorId, reqInfo = {}) {
    const cleanUserId = String(userId || "").trim().toUpperCase();
    const cleanParentId = String(parentId || "").trim().toUpperCase();
    const cleanPosition = String(position || "").trim().toLowerCase();
    const cleanSponsorId = String(sponsorId || "").trim().toUpperCase();

    if (!cleanUserId) {
      throw new AppError("User ID is required for placement", 400);
    }
    if (!VALID_PLACEMENT_POSITIONS.includes(cleanPosition)) {
      throw new AppError(`Position must be either '${PLACEMENT_POSITION.LEFT}' or '${PLACEMENT_POSITION.RIGHT}'`, 400);
    }

    // 1. Validate Child User
    const childUser = await User.findOne({ userId: cleanUserId });
    if (!childUser) {
      throw new AppError(`Member '${cleanUserId}' not found`, 404);
    }

    // 2. Validate Child does not already have a Genealogy node
    const existingNode = await Genealogy.findOne({ userId: cleanUserId });
    if (existingNode) {
      throw new AppError(`Member '${cleanUserId}' is already placed in the genealogy tree`, 409);
    }

    // 3. Handle Root Node vs Child Node
    let ancestors = [];
    if (cleanParentId) {
      if (cleanUserId === cleanParentId) {
        throw new AppError("Self-placement is forbidden: User cannot be their own parent", 400);
      }

      const parentNode = await Genealogy.findOne({ userId: cleanParentId });
      if (!parentNode) {
        throw new AppError(`Parent node '${cleanParentId}' does not exist in the genealogy tree`, 404);
      }

      // Check slot vacancy
      const slotField = cleanPosition === PLACEMENT_POSITION.LEFT ? "leftNodeId" : "rightNodeId";
      if (parentNode[slotField]) {
        await AuditLog.create({
          userId: cleanUserId,
          action: GENEALOGY_AUDIT_ACTIONS.PLACEMENT_REJECTED_OCCUPIED,
          ipAddress: reqInfo.ip || "",
          userAgent: reqInfo.userAgent || "",
          details: `Placement rejected: Parent ${cleanParentId} ${cleanPosition} slot is already occupied by ${parentNode[slotField]}.`,
        });
        throw new AppError(`Parent '${cleanParentId}' already has a ${cleanPosition} child`, 409);
      }

      // 4. Cycle Prevention: Child cannot be in parent's ancestor chain
      if (parentNode.ancestors.includes(cleanUserId)) {
        await AuditLog.create({
          userId: cleanUserId,
          action: GENEALOGY_AUDIT_ACTIONS.CYCLE_DETECTED,
          ipAddress: reqInfo.ip || "",
          userAgent: reqInfo.userAgent || "",
          details: `Cycle detected: Parent ${cleanParentId} is a descendant of ${cleanUserId}.`,
        });
        throw new AppError("Circular genealogy placement detected: Parent is a descendant of child", 400);
      }

      ancestors = [...parentNode.ancestors, cleanParentId];

      // 5. Atomic Single-Document Conditional Parent Slot Lock
      const updateFilter = {
        userId: cleanParentId,
        [slotField]: { $in: ["", null] },
      };
      const updateDoc = {
        $set: { [slotField]: cleanUserId },
      };

      const updatedParent = await Genealogy.findOneAndUpdate(updateFilter, updateDoc, { new: true });
      if (!updatedParent) {
        await AuditLog.create({
          userId: cleanUserId,
          action: GENEALOGY_AUDIT_ACTIONS.PLACEMENT_REJECTED_OCCUPIED,
          ipAddress: reqInfo.ip || "",
          userAgent: reqInfo.userAgent || "",
          details: `Concurrent placement collision: Parent ${cleanParentId} ${cleanPosition} slot was occupied by another process.`,
        });
        throw new AppError("Placement slot was occupied by a concurrent request. Please retry.", 409);
      }
    }

    // 6. Create Genealogy Document for New Child
    let newGenNode;
    try {
      newGenNode = await Genealogy.create({
        userId: cleanUserId,
        parentId: cleanParentId,
        sponsorId: cleanSponsorId || childUser.sponsorId,
        placementLeg: cleanPosition,
        ancestors,
      });
    } catch (err) {
      // Compensating rollback if child insertion fails
      if (cleanParentId) {
        const slotField = cleanPosition === PLACEMENT_POSITION.LEFT ? "leftNodeId" : "rightNodeId";
        await Genealogy.updateOne(
          { userId: cleanParentId, [slotField]: cleanUserId },
          { $set: { [slotField]: "" } }
        );
      }

      if (err.code === 11000) {
        throw new AppError("Duplicate placement conflict: Node or slot is already placed", 409);
      }
      throw err;
    }

    // 7. Synchronize placement fields onto Child User record
    // REGRESSION FIX: Update CHILD User record, NEVER the parent User record!
    await User.findOneAndUpdate(
      { userId: cleanUserId },
      {
        parentId: cleanParentId,
        position: cleanPosition,
      }
    );

    // 8. Audit Logging
    await AuditLog.create({
      userId: cleanUserId,
      action: GENEALOGY_AUDIT_ACTIONS.MEMBER_PLACED,
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `User ${cleanUserId} successfully placed under Parent ${cleanParentId || "ROOT"} on ${cleanPosition} leg (Sponsor: ${cleanSponsorId || childUser.sponsorId}).`,
    });

    // STRICT PHASE 5 INVARIANT:
    // ZERO volume increments, ZERO sales accumulation, ZERO wallet/ledger changes.

    return newGenNode;
  }

  /**
   * Compatibility wrapper for Phase 1 registration.
   */
  async addMember(userId, sponsorId, preferredPosition = "left") {
    const placement = await this.findPlacement(sponsorId, preferredPosition);
    return await this.placeMember(userId, placement.parentId, placement.position, sponsorId);
  }

  /**
   * 4. Retrieves Depth-Bounded Binary Tree.
   * Privacy-filtered and cycle-safe.
   */
  async getBinaryTree(userId, requestedDepth = 4) {
    const cleanUserId = String(userId || "").trim().toUpperCase();
    const maxDepth = Math.max(1, Math.min(parseInt(requestedDepth, 10) || 4, GENEALOGY_TREE_LIMITS.MAX_BINARY_TREE_DEPTH));

    const rootGen = await Genealogy.findOne({ userId: cleanUserId });
    const rootUser = await User.findOne({ userId: cleanUserId });

    if (!rootUser) {
      throw new AppError(`User '${cleanUserId}' not found`, 404);
    }
    if (!rootGen) {
      return this.sanitizeMember(rootUser);
    }

    const visited = new Set();

    const buildTree = async (nodeId, depth) => {
      if (!nodeId || depth > maxDepth) return null;
      if (visited.has(nodeId)) {
        logger.warn(`Cycle skipped in getBinaryTree at node ${nodeId}`);
        return null;
      }
      visited.add(nodeId);

      const [uDoc, gDoc] = await Promise.all([
        User.findOne({ userId: nodeId }).select("userId name rank status activePackage createdAt"),
        Genealogy.findOne({ userId: nodeId }),
      ]);

      if (!uDoc || !gDoc) return null;

      const sanitized = this.sanitizeMember(uDoc, gDoc);

      const [leftChild, rightChild] = await Promise.all([
        buildTree(gDoc.leftNodeId, depth + 1),
        buildTree(gDoc.rightNodeId, depth + 1),
      ]);

      return {
        ...sanitized,
        position: gDoc.placementLeg,
        left: leftChild,
        right: rightChild,
      };
    };

    return await buildTree(cleanUserId, 1);
  }

  /**
   * 5. Retrieves Depth-Bounded Sponsor / Referral Tree.
   * Authoritative unilevel 1-to-N structure.
   */
  async getSponsorTree(userId, requestedDepth = 2) {
    const cleanUserId = String(userId || "").trim().toUpperCase();
    const maxDepth = Math.max(1, Math.min(parseInt(requestedDepth, 10) || 2, GENEALOGY_TREE_LIMITS.MAX_SPONSOR_TREE_DEPTH));

    const rootUser = await User.findOne({ userId: cleanUserId });
    if (!rootUser) {
      throw new AppError(`User '${cleanUserId}' not found`, 404);
    }

    const visited = new Set();

    const buildSponsorTree = async (currentId, depth) => {
      if (!currentId || depth > maxDepth) return null;
      if (visited.has(currentId)) return null;
      visited.add(currentId);

      const uDoc = await User.findOne({ userId: currentId }).select("userId name rank status activePackage createdAt");
      if (!uDoc) return null;

      const sanitized = this.sanitizeMember(uDoc);

      let children = [];
      if (depth < maxDepth) {
        const directs = await User.find({ sponsorId: currentId }).select("userId");
        children = (
          await Promise.all(directs.map((d) => buildSponsorTree(d.userId, depth + 1)))
        ).filter(Boolean);
      }

      return {
        ...sanitized,
        directCount: children.length,
        children,
      };
    };

    return await buildSponsorTree(cleanUserId, 1);
  }

  /**
   * 6. Retrieves Paginated Direct Referrals.
   */
  async getDirectReferrals(userId, options = {}) {
    const cleanUserId = String(userId || "").trim().toUpperCase();
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 20, 100));
    const skip = (page - 1) * limit;

    const query = { sponsorId: cleanUserId };
    if (options.status && ["active", "inactive", "suspended"].includes(options.status)) {
      query.status = options.status;
    }

    const [total, directs] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select("userId name rank status activePackage createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    const sanitizedReferrals = directs.map((u) => this.sanitizeMember(u));

    return {
      referrals: sanitizedReferrals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * 7. Retrieves Fast O(1) Tree Statistics.
   */
  async getTreeStats(userId) {
    const cleanUserId = String(userId || "").trim().toUpperCase();

    const [directCount, rootNode] = await Promise.all([
      User.countDocuments({ sponsorId: cleanUserId }),
      Genealogy.findOne({ userId: cleanUserId }),
    ]);

    if (!rootNode) {
      return {
        leftCount: 0,
        rightCount: 0,
        totalCount: 0,
        directCount,
      };
    }

    const [leftCount, rightCount] = await Promise.all([
      rootNode.leftNodeId ? Genealogy.countDocuments({ ancestors: rootNode.leftNodeId }).then((c) => c + 1) : 0,
      rootNode.rightNodeId ? Genealogy.countDocuments({ ancestors: rootNode.rightNodeId }).then((c) => c + 1) : 0,
    ]);

    return {
      leftCount,
      rightCount,
      totalCount: leftCount + rightCount,
      directCount,
    };
  }

  /**
   * 8. Read-Only Structural Integrity Diagnostics.
   * NEVER silently modifies or repairs data.
   */
  async validateIntegrity(targetUserId = null) {
    const errors = [];
    const warnings = [];

    const query = targetUserId ? { userId: String(targetUserId).trim().toUpperCase() } : {};
    const genNodes = await Genealogy.find(query);

    for (const node of genNodes) {
      // 1. Self-Parent check
      if (node.parentId && node.parentId === node.userId) {
        errors.push({ type: "SELF_PARENT", userId: node.userId, parentId: node.parentId });
      }

      // 2. Cycle in ancestors
      if (node.ancestors.includes(node.userId)) {
        errors.push({ type: "ANCESTOR_CYCLE", userId: node.userId, ancestors: node.ancestors });
      }

      // 3. Duplicate ancestor IDs
      const uniqueAncestors = new Set(node.ancestors);
      if (uniqueAncestors.size !== node.ancestors.length) {
        errors.push({ type: "DUPLICATE_ANCESTORS", userId: node.userId, ancestors: node.ancestors });
      }

      // 4. Missing Parent check
      if (node.parentId) {
        const parentGen = await Genealogy.findOne({ userId: node.parentId });
        if (!parentGen) {
          errors.push({ type: "MISSING_PARENT_GENEALOGY", userId: node.userId, parentId: node.parentId });
        } else {
          // 5. Link Asymmetry check
          const expectedField = node.placementLeg === "left" ? "leftNodeId" : "rightNodeId";
          if (parentGen[expectedField] !== node.userId) {
            errors.push({
              type: "LINK_ASYMMETRY",
              childUserId: node.userId,
              parentId: node.parentId,
              leg: node.placementLeg,
              parentListedChild: parentGen[expectedField],
            });
          }

          // 6. Ancestor chain consistency
          const expectedAncestors = [...parentGen.ancestors, node.parentId];
          if (JSON.stringify(node.ancestors) !== JSON.stringify(expectedAncestors)) {
            warnings.push({
              type: "ANCESTOR_PATH_MISMATCH",
              userId: node.userId,
              recorded: node.ancestors,
              expected: expectedAncestors,
            });
          }
        }
      }

      // 7. Ghost Children checks
      if (node.leftNodeId) {
        const leftGen = await Genealogy.findOne({ userId: node.leftNodeId });
        if (!leftGen) {
          errors.push({ type: "GHOST_LEFT_CHILD", parentId: node.userId, leftNodeId: node.leftNodeId });
        }
      }
      if (node.rightNodeId) {
        const rightGen = await Genealogy.findOne({ userId: node.rightNodeId });
        if (!rightGen) {
          errors.push({ type: "GHOST_RIGHT_CHILD", parentId: node.userId, rightNodeId: node.rightNodeId });
        }
      }
    }

    // 8. Orphan User check (User exists but missing Genealogy record)
    const users = await User.find(query).select("userId sponsorId");
    for (const u of users) {
      if (u.sponsorId && u.sponsorId !== "none" && u.sponsorId !== "ROOT") {
        const g = await Genealogy.findOne({ userId: u.userId });
        if (!g) {
          warnings.push({ type: "ORPHAN_USER_WITHOUT_GENEALOGY", userId: u.userId, sponsorId: u.sponsorId });
        }
      }
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      await AuditLog.create({
        userId: targetUserId || "SYSTEM",
        action: GENEALOGY_AUDIT_ACTIONS.INTEGRITY_MISMATCH,
        details: `Genealogy integrity audit detected ${errors.length} errors and ${warnings.length} warnings.`,
      });
    }

    return {
      valid: isValid,
      totalChecked: genNodes.length,
      errors,
      warnings,
    };
  }

  /**
   * Helper: Check if targetId is in requestUser's binary downline.
   */
  async isBinaryDownline(rootUserId, targetUserId) {
    if (!rootUserId || !targetUserId) return false;
    if (rootUserId === targetUserId) return true;

    const targetNode = await Genealogy.findOne({ userId: targetUserId });
    if (!targetNode) return false;

    return targetNode.ancestors.includes(rootUserId);
  }

  /**
   * Helper: Check if targetId is in requestUser's sponsor downline.
   */
  async isSponsorDownline(rootUserId, targetUserId) {
    if (!rootUserId || !targetUserId) return false;
    if (rootUserId === targetUserId) return true;

    let currentId = targetUserId;
    let depth = 0;
    const visited = new Set();

    while (currentId && currentId !== "none" && currentId !== "ROOT" && depth < 50) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const user = await User.findOne({ userId: currentId });
      if (!user) break;

      if (user.sponsorId === rootUserId) return true;
      currentId = user.sponsorId;
      depth++;
    }

    return false;
  }
}

export default new GenealogyService();
