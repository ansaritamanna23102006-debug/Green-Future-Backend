import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import Settings from "../models/Settings.js";
import Package from "../models/Package.js";
import logger from "../config/logger.js";

class IncomeService {
  /**
   * Calculates and pays Direct Referral Income.
   * 10% of purchased package value is paid to the sponsor.
   */
  async payDirectIncome(buyerUserId, packagePrice) {
    try {
      const buyer = await User.findOne({ userId: buyerUserId });
      if (!buyer || buyer.sponsorId === "none") return;

      const sponsor = await User.findOne({ userId: buyer.sponsorId });
      if (!sponsor) return;

      const settings = await Settings.findOne({ key: "global_settings" }) || { directIncomePercentage: 10 };
      const commissionAmount = (packagePrice * settings.directIncomePercentage) / 100;

      // Update Sponsor's Wallet
      const wallet = await Wallet.findOne({ userId: sponsor.userId });
      if (wallet) {
        wallet.incomeWallet += commissionAmount;
        wallet.totalEarned += commissionAmount;
        await wallet.save();
      }

      // Log Transaction
      await Transaction.create({
        user: sponsor._id,
        userId: sponsor.userId,
        amount: commissionAmount,
        currency: "INR",
        type: "credit",
        category: "direct_income",
        description: `Direct Referral Commission from purchase of package by downline ${buyerUserId}`,
        referenceId: buyerUserId,
      });

      logger.info(`Paid Direct Income of ₹${commissionAmount} to Sponsor ${sponsor.userId} for buyer ${buyerUserId}`);
    } catch (error) {
      logger.error(`Error paying direct income for buyer ${buyerUserId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Runs the Binary Matching Commission calculation.
   * Matches leftLegSalesVolume and rightLegSalesVolume (12% matching rate).
   * Differentiates matches, calculates carry forward, checks package capping, and records.
   */
  async runWeeklyBinaryMatching() {
    try {
      logger.info("Starting weekly binary matching calculations...");
      const users = await User.find({ status: "active" }).populate("activePackage.packageId");
      const settings = await Settings.findOne({ key: "global_settings" }) || { binaryIncomePercentage: 12 };

      for (const user of users) {
        const leftVol = user.leftLegSalesVolume;
        const rightVol = user.rightLegSalesVolume;

        if (leftVol <= 0 || rightVol <= 0) continue;

        // Calculate matching amount
        const matchingVolume = Math.min(leftVol, rightVol);
        let matchingIncome = (matchingVolume * settings.binaryIncomePercentage) / 100;

        // Enforce Weekly Capping based on Package tier
        let capLimit = 15000; // Default min cap
        if (user.activePackage && user.activePackage.packageId) {
          capLimit = user.activePackage.packageId.weeklyMatchingCapping || capLimit;
        }

        if (matchingIncome > capLimit) {
          logger.info(`Capped binary matching income of user ${user.userId} from ₹${matchingIncome} to limit ₹${capLimit}`);
          matchingIncome = capLimit;
        }

        // Calculate carry forward remaining volumes
        const leftCarry = leftVol - matchingVolume;
        const rightCarry = rightVol - matchingVolume;

        // Update User Sales Volume accumulators (reset matching portion, keep carry forward)
        user.leftLegSalesVolume = leftCarry;
        user.rightLegSalesVolume = rightCarry;
        await user.save();

        // Credit matching income to Wallet
        const wallet = await Wallet.findOne({ userId: user.userId });
        if (wallet) {
          wallet.incomeWallet += matchingIncome;
          wallet.totalEarned += matchingIncome;
          await wallet.save();
        }

        // Log Transaction
        await Transaction.create({
          user: user._id,
          userId: user.userId,
          amount: matchingIncome,
          currency: "INR",
          type: "credit",
          category: "binary_matching",
          description: `Weekly Binary Matching Income. Volume Matched: ₹${matchingVolume}`,
          referenceId: `MATCH-${Date.now()}`,
        });

        logger.info(`Paid Binary matching income of ₹${matchingIncome} to User ${user.userId}`);
      }
      logger.info("Weekly binary matching calculation completed successfully.");
    } catch (error) {
      logger.error(`Binary matching script failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Distributes passive token yield APY.
   * Runs daily (or monthly) based on active package configurations.
   */
  async runDailyStakingYield() {
    try {
      logger.info("Calculating daily passive staking yields...");
      const users = await User.find({ status: "active" }).populate("activePackage.packageId");

      for (const user of users) {
        if (!user.activePackage || !user.activePackage.packageId) continue;

        const pkg = user.activePackage.packageId;
        const dailyRate = pkg.dailyYieldRate || 0.05; // 0.05% daily
        const yieldIncome = (user.activePackage.amount * dailyRate) / 100;

        if (yieldIncome <= 0) continue;

        const wallet = await Wallet.findOne({ userId: user.userId });
        if (wallet) {
          wallet.incomeWallet += yieldIncome;
          wallet.totalEarned += yieldIncome;
          await wallet.save();
        }

        await Transaction.create({
          user: user._id,
          userId: user.userId,
          amount: yieldIncome,
          currency: "INR",
          type: "credit",
          category: "passive_yield",
          description: `Daily passive yield on Eco package ${pkg.name}`,
          referenceId: pkg.name,
        });

        logger.debug(`Credited daily yield ₹${yieldIncome} to user ${user.userId}`);
      }
      logger.info("Daily passive yields updated successfully.");
    } catch (error) {
      logger.error(`Daily passive yields calculations failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculates monthly system sales and splits 5% turnover pool among emerald and above ranks.
   */
  async distributeGlobalPool() {
    try {
      logger.info("Starting Global Turnover Pool distribution...");
      
      // Calculate total system sales volume in the past month from completed package purchases
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const totalSalesAgg = await Transaction.aggregate([
        {
          $match: {
            category: "package_purchase",
            status: "completed",
            createdAt: { $gte: oneMonthAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: "$amount" }
          }
        }
      ]);

      const totalSales = totalSalesAgg[0] ? totalSalesAgg[0].totalSales : 0;
      if (totalSales <= 0) {
        logger.info("No system sales recorded in the past month. Skipping Global Pool.");
        return;
      }

      const poolAmount = (totalSales * 5) / 100; // 5% of monthly sales
      
      // Eligible ranks: emerald, platinum, diamond, ruby, chairman
      const eligibleUsers = await User.find({
        rank: { $in: ["emerald", "platinum", "diamond", "ruby", "chairman"] },
        status: "active"
      });

      if (eligibleUsers.length === 0) {
        logger.info("No users qualified for global pool in this period.");
        return;
      }

      const splitAmount = poolAmount / eligibleUsers.length;

      for (const user of eligibleUsers) {
        const wallet = await Wallet.findOne({ userId: user.userId });
        if (wallet) {
          wallet.incomeWallet += splitAmount;
          wallet.totalEarned += splitAmount;
          await wallet.save();
        }

        await Transaction.create({
          user: user._id,
          userId: user.userId,
          amount: splitAmount,
          currency: "INR",
          type: "credit",
          category: "global_pool",
          description: `Monthly Global Pool Share. System Sales: ₹${totalSales}, Qualified Users: ${eligibleUsers.length}`,
          referenceId: `POOL-${Date.now()}`,
        });

        logger.info(`Paid Global pool share ₹${splitAmount} to qualified user ${user.userId}`);
      }
    } catch (error) {
      logger.error(`Global pool distribution failed: ${error.message}`);
      throw error;
    }
  }
}

export default new IncomeService();
