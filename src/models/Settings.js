import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "global_settings",
    },
    directIncomePercentage: {
      type: Number,
      default: 10,
    },
    binaryIncomePercentage: {
      type: Number,
      default: 12,
    },
    kycRequiredForWithdrawal: {
      type: Boolean,
      default: true,
    },
    minWithdrawalAmount: {
      type: Number,
      default: 500, // E.g., ₹500 minimum
    },
    stakingAPY: {
      type: Number,
      default: 18,
    },
    // Rank thresholds (Left/Right leg volume matching criteria)
    silverThreshold: { type: Number, default: 50000 },
    goldThreshold: { type: Number, default: 150000 },
    emeraldThreshold: { type: Number, default: 450000 },
    platinumThreshold: { type: Number, default: 1200000 },
    diamondThreshold: { type: Number, default: 3500000 },
    rubyThreshold: { type: Number, default: 10000000 },
    chairmanThreshold: { type: Number, default: 30000000 },
  },
  {
    timestamps: true,
  }
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
