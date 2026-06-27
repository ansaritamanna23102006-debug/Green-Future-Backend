import User from "../models/User.js";
import Reward from "../models/Reward.js";
import Settings from "../models/Settings.js";
import logger from "../config/logger.js";

class NetworkService {
  /**
   * Evaluates user's cumulative sales volumes on Left/Right legs,
   * upgrades their rank, and unlocks qualifying reward assets (Watch, Bike, Car, etc.).
   */
  async checkRankAndRewardUpgrades(userId) {
    try {
      const user = await User.findOne({ userId });
      if (!user || user.status !== "active") return;

      const settings = await Settings.findOne({ key: "global_settings" }) || {
        silverThreshold: 50000,
        goldThreshold: 150000,
        emeraldThreshold: 450000,
        platinumThreshold: 1200000,
        diamondThreshold: 3500000,
        rubyThreshold: 10000000,
        chairmanThreshold: 30000000,
      };

      const leftVol = user.leftLegSalesVolume;
      const rightVol = user.rightLegSalesVolume;
      const matchingVolume = Math.min(leftVol, rightVol);

      let newRank = "none";
      let rewardToUnlock = "";

      if (matchingVolume >= settings.chairmanThreshold) {
        newRank = "chairman";
        rewardToUnlock = "Chairman Rewards";
      } else if (matchingVolume >= settings.rubyThreshold) {
        newRank = "ruby";
        rewardToUnlock = "Trip";
      } else if (matchingVolume >= settings.diamondThreshold) {
        newRank = "diamond";
        rewardToUnlock = "Trip";
      } else if (matchingVolume >= settings.platinumThreshold) {
        newRank = "platinum";
        rewardToUnlock = "Car";
      } else if (matchingVolume >= settings.emeraldThreshold) {
        newRank = "emerald";
        rewardToUnlock = "Car";
      } else if (matchingVolume >= settings.goldThreshold) {
        newRank = "gold";
        rewardToUnlock = "Bike";
      } else if (matchingVolume >= settings.silverThreshold) {
        newRank = "silver";
        rewardToUnlock = "Watch";
      }

      // Check if rank needs to be updated
      const rankHierarchy = ["none", "silver", "gold", "emerald", "platinum", "diamond", "ruby", "chairman"];
      const currentRankIndex = rankHierarchy.indexOf(user.rank);
      const newRankIndex = rankHierarchy.indexOf(newRank);

      if (newRankIndex > currentRankIndex) {
        logger.info(`Promoting user ${user.userId} from rank ${user.rank} to ${newRank}`);
        user.rank = newRank;
        await user.save();

        // Unlock reward if applicable
        if (rewardToUnlock) {
          const rewardExists = await Reward.findOne({ userId: user.userId, rewardName: rewardToUnlock });
          if (!rewardExists) {
            await Reward.create({
              user: user._id,
              userId: user.userId,
              rewardName: rewardToUnlock,
              status: "pending",
              notes: `Unlocked upon achieving the ${newRank.toUpperCase()} rank milestone.`,
            });
            logger.info(`Unlocked ${rewardToUnlock} reward for user ${user.userId}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error checking ranks/rewards for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks rank promotions for all active users (usually triggered daily via cron).
   */
  async checkAllUsersRankPromotions() {
    try {
      logger.info("Scanning network for rank promotions...");
      const activeUsers = await User.find({ status: "active" });
      for (const user of activeUsers) {
        await this.checkRankAndRewardUpgrades(user.userId);
      }
      logger.info("Network rank promotion scan complete.");
    } catch (error) {
      logger.error(`Rank scan error: ${error.message}`);
      throw error;
    }
  }
}

export default new NetworkService();
