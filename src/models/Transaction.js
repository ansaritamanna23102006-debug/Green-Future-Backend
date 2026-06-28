import mongoose from "mongoose";

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

transactionSchema.post("save", async function (doc) {
  try {
    if (doc.type === "credit" && doc.status === "completed") {
      const bonusCategories = [
        "direct_income",
        "binary_matching",
        "passive_yield",
        "global_pool",
      ];
      if (bonusCategories.includes(doc.category)) {
        const { default: tokenSupplyService } = await import("../services/tokenSupplyService.js");
        await tokenSupplyService.distributeBonus(doc.amount);
      }
    }
  } catch (err) {
    console.error("Error in Transaction post-save hook:", err);
  }
});

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
