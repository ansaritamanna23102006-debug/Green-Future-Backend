import mongoose from "mongoose";

const packageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    dailyYieldRate: {
      type: Number, // Percentage e.g. 0.05% per day (approx 18% APY)
      required: true,
      default: 0.05,
    },
    weeklyMatchingCapping: {
      type: Number, // Maximum matching income cap per week E.g. 50000
      required: true,
    },
    tokenRewardAmount: {
      type: Number, // Amount of native GFT tokens given upon buying
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

const Package = mongoose.model("Package", packageSchema);
export default Package;
