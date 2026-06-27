import mongoose from "mongoose";

const rewardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    rewardName: {
      type: String,
      required: true,
      enum: ["Watch", "Bike", "Car", "Trip", "Chairman Rewards"],
    },
    status: {
      type: String,
      enum: ["pending", "delivered", "completed"],
      default: "pending",
    },
    unlockedAt: {
      type: Date,
      default: Date.now,
    },
    deliveredAt: {
      type: Date,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const Reward = mongoose.model("Reward", rewardSchema);
export default Reward;
