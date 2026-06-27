import User from "../models/User.js";
import Genealogy from "../models/Genealogy.js";
import AppError from "../utils/errors.js";
import logger from "../config/logger.js";

class GenealogyService {
  /**
   * Finds the exact placement parent and position in the binary tree.
   * Uses Extreme Outer Leg placement strategy:
   * - If position is "left", follow the left child's left-most path until an empty left spot is found.
   * - If position is "right", follow the right child's right-most path until an empty right spot is found.
   * - If position is "auto", find the leg with less volume or first available spot.
   */
  async findPlacement(sponsorId, preferredPosition = "left") {
    const sponsor = await User.findOne({ userId: sponsorId });
    if (!sponsor) {
      throw new AppError(`Sponsor with ID ${sponsorId} not found`, 404);
    }

    let position = preferredPosition.toLowerCase();
    if (position !== "left" && position !== "right") {
      // Auto placement: pick the side with less volume, default to left
      const sponsorNode = await Genealogy.findOne({ userId: sponsorId });
      if (!sponsorNode || !sponsorNode.leftNodeId) {
        position = "left";
      } else if (!sponsorNode.rightNodeId) {
        position = "right";
      } else {
        // Pick the side with less current volume accumulators on the sponsor's user profile
        position = sponsor.leftLegSalesVolume <= sponsor.rightLegSalesVolume ? "left" : "right";
      }
    }

    let currentUserId = sponsorId;
    let found = false;
    let parentId = "";

    // Traverse down the extreme leg
    while (!found) {
      const currentNode = await Genealogy.findOne({ userId: currentUserId });
      if (!currentNode) {
        // First node in the entire system
        parentId = "";
        found = true;
        break;
      }

      if (position === "left") {
        if (!currentNode.leftNodeId) {
          parentId = currentUserId;
          found = true;
        } else {
          currentUserId = currentNode.leftNodeId;
        }
      } else {
        // position === "right"
        if (!currentNode.rightNodeId) {
          parentId = currentUserId;
          found = true;
        } else {
          currentUserId = currentNode.rightNodeId;
        }
      }
    }

    return { parentId, position };
  }

  /**
   * Registers a user in the Genealogy tree and updates all upline leg stats.
   */
  async addMember(userId, sponsorId, preferredPosition = "left") {
    try {
      // 1. Get placement parent and position
      const { parentId, position } = await this.findPlacement(sponsorId, preferredPosition);

      // 2. Fetch parent genealogy node to construct ancestors array
      let ancestors = [];
      if (parentId) {
        const parentNode = await Genealogy.findOne({ userId: parentId });
        if (parentNode) {
          ancestors = [...parentNode.ancestors, parentId];
        }
      }

      // 3. Create Genealogy record for the new user
      const newGenNode = await Genealogy.create({
        userId,
        parentId,
        sponsorId,
        placementLeg: position,
        ancestors,
      });

      // 4. Update parent's left/right node links
      if (parentId) {
        const updateField = position === "left" ? { leftNodeId: userId } : { rightNodeId: userId };
        await Genealogy.findOneAndUpdate({ userId: parentId }, updateField);
        
        // Also update parent User's schema fields
        await User.findOneAndUpdate({ userId: parentId }, {
          parentId,
          position
        });
      }

      // 5. Accumulate counts for all uplines
      if (ancestors.length > 0) {
        await this.updateUplineStats(userId, ancestors);
      }

      logger.info(`User ${userId} placed under Parent ${parentId} on ${position} leg`);
      return newGenNode;
    } catch (error) {
      logger.error(`Genealogy Registration Error for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper function to traverse all uplines and increment leg volume or counts.
   */
  async updateUplineStats(newUserId, ancestors) {
    // For each ancestor, determine if the new user is in their left or right leg
    // If ancestor list: [GFT001, GFT002, GFT003, GFT004] and new user is GFT005
    // under GFT001, the path goes to GFT002. GFT002's placementLeg determines GFT005's leg under GFT001.
    
    // We fetch placement legs for all descendants in the path
    const nodes = await Genealogy.find({ userId: { $in: ancestors } });
    const legMap = new Map(nodes.map(n => [n.userId, n.placementLeg]));
    
    // Also the new user's leg is known: the last ancestor is the parent
    const parentId = ancestors[ancestors.length - 1];
    const parentNode = await Genealogy.findOne({ userId: newUserId });
    const newUserLeg = parentNode ? parentNode.placementLeg : "left";
    
    for (let i = 0; i < ancestors.length; i++) {
      const ancestorId = ancestors[i];
      let leg = "left";

      if (ancestorId === parentId) {
        leg = newUserLeg;
      } else {
        // Find the next node in the ancestor path after the current ancestor
        const nextNodeInPath = ancestors[i + 1];
        leg = legMap.get(nextNodeInPath) || "left";
      }

      // Increment active user counts for that leg on the User document
      const incrementField = leg === "left" 
        ? { leftLegActiveUsers: 1 } 
        : { rightLegActiveUsers: 1 };
      
      await User.findOneAndUpdate({ userId: ancestorId }, { $inc: incrementField });
    }
  }

  /**
   * Traverses down and accumulates sales volume for uplines when a package is activated.
   */
  async addSalesVolume(userId, volumeAmount) {
    const genNode = await Genealogy.findOne({ userId });
    if (!genNode || genNode.ancestors.length === 0) return;

    const ancestors = genNode.ancestors;
    
    // Fetch paths to determine legs
    const pathNodes = await Genealogy.find({ userId: { $in: ancestors } });
    const legMap = new Map(pathNodes.map(n => [n.userId, n.placementLeg]));
    
    const parentId = ancestors[ancestors.length - 1];
    const userLeg = genNode.placementLeg;

    for (let i = 0; i < ancestors.length; i++) {
      const ancestorId = ancestors[i];
      let leg = "left";

      if (ancestorId === parentId) {
        leg = userLeg;
      } else {
        const nextNodeInPath = ancestors[i + 1];
        leg = legMap.get(nextNodeInPath) || "left";
      }

      // Add to sales volumes
      const volumeField = leg === "left" 
        ? { leftLegSalesVolume: volumeAmount } 
        : { rightLegSalesVolume: volumeAmount };

      await User.findOneAndUpdate({ userId: ancestorId }, { $inc: volumeField });
    }
    logger.info(`Added sales volume of ${volumeAmount} to uplines of ${userId}`);
  }

  /**
   * Retrieves all downline members recursively (Binary Tree).
   */
  async getDownline(userId, maxDepth = 4) {
    const root = await Genealogy.findOne({ userId });
    if (!root) return null;

    const buildTree = async (nodeId, depth) => {
      if (!nodeId || depth > maxDepth) return null;
      
      const userObj = await User.findOne({ userId: nodeId }).select("name email rank activePackage status");
      const genObj = await Genealogy.findOne({ userId: nodeId });

      if (!userObj || !genObj) return null;

      return {
        userId: nodeId,
        name: userObj.name,
        rank: userObj.rank,
        package: userObj.activePackage.name || "None",
        status: userObj.status,
        position: genObj.placementLeg,
        left: await buildTree(genObj.leftNodeId, depth + 1),
        right: await buildTree(genObj.rightNodeId, depth + 1),
      };
    };

    return await buildTree(userId, 1);
  }

  /**
   * Gets simple tree statistics: total left members, total right members, active/inactive counts.
   */
  async getTreeStats(userId) {
    const root = await Genealogy.findOne({ userId });
    if (!root) return { leftCount: 0, rightCount: 0 };

    const countNodes = async (nodeId) => {
      if (!nodeId) return 0;
      const node = await Genealogy.findOne({ userId: nodeId });
      if (!node) return 0;
      return 1 + (await countNodes(node.leftNodeId)) + (await countNodes(node.rightNodeId));
    };

    const leftCount = await countNodes(root.leftNodeId);
    const rightCount = await countNodes(root.rightNodeId);

    return {
      leftCount,
      rightCount,
      totalCount: leftCount + rightCount,
    };
  }
}

export default new GenealogyService();
