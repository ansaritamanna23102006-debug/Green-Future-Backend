import cron from "node-cron";
import IncomeService from "../services/incomeService.js";
import NetworkService from "../services/networkService.js";
import Offer from "../models/Offer.js";
import logger from "../config/logger.js";

// Initialize scheduled crons
export const initCronJobs = () => {
  logger.info("Initializing node-cron schedule tasks...");

  // 1. Daily Staking Yield Calculation (Every midnight at 00:00)
  cron.schedule("0 0 * * *", async () => {
    try {
      logger.info("[CRON] Running daily staking yield distribution...");
      await IncomeService.runDailyStakingYield();
    } catch (err) {
      logger.error(`[CRON ERROR] Daily staking yield failed: ${err.message}`);
    }
  });

  // 2. Rank Promotions and Milestone Checks (Every day at 01:00 AM)
  cron.schedule("0 1 * * *", async () => {
    try {
      logger.info("[CRON] Running rank promotion scanner...");
      await NetworkService.checkAllUsersRankPromotions();
    } catch (err) {
      logger.error(`[CRON ERROR] Rank promotion scan failed: ${err.message}`);
    }
  });

  // 3. Weekly Binary Matching Payouts (Every Sunday midnight at 23:59)
  cron.schedule("59 23 * * 0", async () => {
    try {
      logger.info("[CRON] Running weekly binary matching volume calculations...");
      await IncomeService.runWeeklyBinaryMatching();
    } catch (err) {
      logger.error(`[CRON ERROR] Weekly binary matching failed: ${err.message}`);
    }
  });

  // 4. Monthly Global Pool Share Payouts (First day of every month at 02:00 AM)
  cron.schedule("0 2 1 * *", async () => {
    try {
      logger.info("[CRON] Running monthly Global Turnover Pool distribution...");
      await IncomeService.distributeGlobalPool();
    } catch (err) {
      logger.error(`[CRON ERROR] Global pool distribution failed: ${err.message}`);
    }
  });

  // 5. Expire offers check (Every hour)
  cron.schedule("0 * * * *", async () => {
    try {
      const now = new Date();
      const expiredCount = await Offer.updateMany(
        { expiryDate: { $lte: now }, status: "active" },
        { status: "expired" }
      );
      if (expiredCount.modifiedCount > 0) {
        logger.info(`[CRON] Expired ${expiredCount.modifiedCount} marketing offers`);
      }
    } catch (err) {
      logger.error(`[CRON ERROR] Expire offers check failed: ${err.message}`);
    }
  });

  // 6. Expire packages and return tokens (Every day at 03:00 AM)
  cron.schedule("0 3 * * *", async () => {
    try {
      logger.info("[CRON] Running expired package/ID status sweep...");
      const { default: tokenSupplyService } = await import("../services/tokenSupplyService.js");
      const User = (await import("../models/User.js")).default;
      const now = new Date();
      const expiredUsers = await User.find({
        status: "active",
        "activePackage.expiresAt": { $lte: now }
      });
      for (const u of expiredUsers) {
        u.status = "inactive";
        const amt = u.activePackage?.amount || 0;
        if (amt > 0) {
          await tokenSupplyService.returnTokens(amt);
        }
        await u.save();
        logger.info(`[CRON] Deactivated expired user ID ${u.userId} and returned ${amt} GFT tokens to supply`);
      }
    } catch (err) {
      logger.error(`[CRON ERROR] Expired package status sweep failed: ${err.message}`);
    }
  });
};

export default initCronJobs;
