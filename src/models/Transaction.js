import mongoose from "mongoose";

/**
 * Legacy Transaction Model (Phase 4: Read-Only Historical Archive)
 * 
 * IMPORTANT:
 * - The legacy post-save hook that triggered secondary token distributions has been REMOVED.
 * - This model serves as historical archive for legacy transactions.
 * - All authoritative new financial transactions write exclusively to JournalEntry and LedgerPosting.
 */
const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      enum: ["INR", "USDT", "GFT"],
      default: "INR",
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "direct_income",
        "binary_matching",
        "passive_yield",
        "global_pool",
        "transfer",
        "withdrawal",
        "package_purchase",
        "registration_bonus"
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    description: {
      type: String,
      required: true,
    },
    referenceId: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for historical user lookups
transactionSchema.index({ userId: 1, createdAt: -1 });

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
