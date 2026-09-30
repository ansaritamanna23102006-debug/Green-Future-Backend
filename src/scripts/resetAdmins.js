import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";

async function run() {
  try {
    await connectDB();
    console.log("Connected to MongoDB for admin reset...");

    // 1. Delete all existing admin and superadmin accounts
    const deleteResult = await User.deleteMany({
      $or: [
        { role: "superadmin" },
        { role: "admin" },
        { email: { $in: ["superadmin@greenfuturetech.com", "superadmin@gft.com", "admin@gft.com", "admin@greenfuturetech.com"] } },
        { userId: { $in: ["GFT000001", "GFT000002", "SUPERADMIN", "ADMIN"] } },
      ],
    });
    console.log(`Deleted ${deleteResult.deletedCount} existing admin/superadmin accounts.`);

    // 2. Create brand-new Superadmin with simple credentials
    const superAdmin = await User.create({
      userId: "GFT000001",
      sponsorId: "none",
      sponsorName: "System",
      name: "Super Administrator",
      email: "superadmin@gft.com",
      mobile: "9999999991",
      password: "admin123",
      role: "superadmin",
      status: "active",
      referralCode: "SUPERADMIN",
      isEmailVerified: true,
      isMobileVerified: true,
    });
    console.log("Created Superadmin: userId=GFT000001, email=superadmin@gft.com, pass=admin123");

    // Ensure wallet exists for Superadmin
    await Wallet.findOneAndUpdate(
      { userId: "GFT000001" },
      {
        user: superAdmin._id,
        userId: "GFT000001",
        availablePaisa: 10000000,
        lockedPaisa: 0,
        totalEarnedPaisa: 0,
        version: 1,
      },
      { upsert: true, new: true }
    );

    // 3. Create brand-new Admin with simple credentials
    const admin = await User.create({
      userId: "GFT000002",
      sponsorId: "none",
      sponsorName: "System",
      name: "System Administrator",
      email: "admin@gft.com",
      mobile: "9999999992",
      password: "admin123",
      role: "admin",
      status: "active",
      referralCode: "ADMIN",
      isEmailVerified: true,
      isMobileVerified: true,
    });
    console.log("Created Admin: userId=GFT000002, email=admin@gft.com, pass=admin123");

    // Ensure wallet exists for Admin
    await Wallet.findOneAndUpdate(
      { userId: "GFT000002" },
      {
        user: admin._id,
        userId: "GFT000002",
        availablePaisa: 5000000,
        lockedPaisa: 0,
        totalEarnedPaisa: 0,
        version: 1,
      },
      { upsert: true, new: true }
    );

    console.log("\n=========================================");
    console.log("SUCCESSFULLY RESET ALL ADMIN CREDENTIALS");
    console.log("Superadmin: superadmin / superadmin@gft.com / GFT000001 | Password: admin123");
    console.log("Admin:      admin / admin@gft.com / GFT000002           | Password: admin123");
    console.log("=========================================\n");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Failed to reset admin credentials:", err);
    process.exit(1);
  }
}

run();
