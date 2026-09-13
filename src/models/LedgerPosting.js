import mongoose from "mongoose";
import { POSTING_DIRECTION, SUPPORTED_LEDGER_CURRENCIES } from "../utils/rules/ledgerConstants.js";

const ledgerPostingSchema = new mongoose.Schema(
  {
    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      required: true,
      index: true,
    },
    accountId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    walletType: {
      type: String,
      required: true,
      trim: true,
    },
    currency: {
      type: String,
      enum: SUPPORTED_LEDGER_CURRENCIES,
      default: "INR",
      required: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      validate: {
        validator: function (val) {
          return Number.isSafeInteger(val) && val > 0;
        },
        message: "amountPaisa must be a positive safe integer (> 0).",
      },
    },
    direction: {
      type: String,
      enum: Object.values(POSTING_DIRECTION),
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast account & user statement queries
ledgerPostingSchema.index({ userId: 1, currency: 1, createdAt: -1 });
ledgerPostingSchema.index({ accountId: 1, createdAt: -1 });

// Immutability Guards: Absolutely no modifications or deletions permitted
ledgerPostingSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  throw new Error("Fatal: LedgerPosting records are strictly immutable and cannot be updated.");
});

ledgerPostingSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Fatal: LedgerPosting records are strictly immutable and cannot be deleted.");
});

const LedgerPosting = mongoose.model("LedgerPosting", ledgerPostingSchema);
export default LedgerPosting;
