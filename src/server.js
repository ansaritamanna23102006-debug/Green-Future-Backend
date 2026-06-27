import "dotenv/config";
import http from "http";
import app from "./app.js";
import connectDB from "./config/db.js";
import logger from "./config/logger.js";
import { initSocket } from "./socket/index.js";
import initCronJobs from "./cron/index.js";

// Database Models for Seeding
import User from "./models/User.js";
import Settings from "./models/Settings.js";
import Package from "./models/Package.js";

// 1. Establish Database Connection
await connectDB();

const server = http.createServer(app);

// 2. Initialize Sockets
initSocket(server);

// 3. Initialize Cron Jobs
initCronJobs();

// 4. Seeding Initial Setup Data
const seedSystem = async () => {
  try {
    // A. Seed Global Settings
    let settings = await Settings.findOne({ key: "global_settings" });
    if (!settings) {
      settings = await Settings.create({ key: "global_settings" });
      logger.info("[SEED] Default global settings parameters initialized");
    }

    // B. Seed Default MLM Investment Packages
    const packageCount = await Package.countDocuments();
    if (packageCount === 0) {
      const defaultPackages = [
        { name: "GFT-1", price: 3000, dailyYieldRate: 0.05, weeklyMatchingCapping: 15000, tokenRewardAmount: 50 },
        { name: "GFT-2", price: 6000, dailyYieldRate: 0.05, weeklyMatchingCapping: 30000, tokenRewardAmount: 100 },
        { name: "GFT-3", price: 12000, dailyYieldRate: 0.05, weeklyMatchingCapping: 60000, tokenRewardAmount: 200 },
        { name: "GFT-4", price: 25000, dailyYieldRate: 0.05, weeklyMatchingCapping: 120000, tokenRewardAmount: 450 },
        { name: "GFT-5", price: 50000, dailyYieldRate: 0.05, weeklyMatchingCapping: 250000, tokenRewardAmount: 1000 },
        { name: "GFT-6", price: 100000, dailyYieldRate: 0.05, weeklyMatchingCapping: 500000, tokenRewardAmount: 2200 },
        { name: "GFT-7", price: 250000, dailyYieldRate: 0.05, weeklyMatchingCapping: 1200000, tokenRewardAmount: 6000 },
        { name: "GFT-8", price: 500000, dailyYieldRate: 0.05, weeklyMatchingCapping: 2500000, tokenRewardAmount: 13000 },
      ];
      await Package.insertMany(defaultPackages);
      logger.info("[SEED] Seeding GFT MLM packages (GFT-1 to GFT-8) complete");
    }

    // C. Seed Initial Super Admin
    const superAdminExists = await User.findOne({ role: "superadmin" });
    if (!superAdminExists) {
      const initEmail = process.env.INIT_SUPERADMIN_EMAIL || "superadmin@greenfuturetech.com";
      const initPass = process.env.INIT_SUPERADMIN_PASS || "AdminPass123!";
      
      await User.create({
        userId: "GFT000001",
        sponsorId: "none",
        name: "GFT Super Admin",
        email: initEmail,
        mobile: "0000000000",
        password: initPass,
        role: "superadmin",
        status: "active",
        referralCode: "SUPERADMIN",
      });
      logger.info(`[SEED] Super Admin GFT000001 seeded successfully. Email: ${initEmail}`);
    }
  } catch (err) {
    logger.error(`[SEED ERROR] Failed to seed default system: ${err.message}`);
  }
};

await seedSystem();

// 5. Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`GFT Web Server started running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
