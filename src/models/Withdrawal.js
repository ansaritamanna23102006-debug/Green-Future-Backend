import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
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
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    paymentMethod: {
      type: String,
      enum: ["USDT_WALLET", "BANK_TRANSFER"],
      required: true,
    },
    details: {
      type: String, // Stringified bank details or USDT address
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    rejectReason: {
      type: String,
      default: "",
    },
    txHash: {
      type: String, // Transaction hash for blockchain transfers
      default: "",
    },
    processedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);
export default Withdrawal;
