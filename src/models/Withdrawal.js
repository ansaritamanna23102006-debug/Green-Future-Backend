import mongoose from "mongoose";
import { WITHDRAWAL_STATUS, DESTINATION_TYPES } from "../services/withdrawal/withdrawalConstants.js";

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "amountPaisa must be an exact integer.",
      },
    },
    feePaisa: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "feePaisa must be an exact integer.",
      },
    },
    netAmountPaisa: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "netAmountPaisa must be an exact integer.",
      },
    },
    currency: {
      type: String,
      default: "INR",
      enum: ["INR"],
    },
    destinationType: {
      type: String,
      enum: Object.values(DESTINATION_TYPES),
      required: true,
    },
    destinationReference: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(WITHDRAWAL_STATUS),
      default: WITHDRAWAL_STATUS.REQUESTED,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    referenceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    holdJournalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      required: true,
    },
    settlementJournalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
    reversalJournalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
    providerReference: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    ruleVersion: {
      type: String,
      required: true,
    },
    calculationSnapshot: {
      grossAmountPaisa: { type: Number, required: true },
      feePercentage: { type: Number, required: true },
      feePaisa: { type: Number, required: true },
      netAmountPaisa: { type: Number, required: true },
      currency: { type: String, default: "INR" },
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: String,
      default: null,
    },
    processingAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: String,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user query sorting
withdrawalSchema.index({ userId: 1, createdAt: -1 });

// Prevent accidental deletion or mutation of historical financial records
withdrawalSchema.pre("deleteOne", function () {
  throw new Error("Financial Withdrawal records are immutable and cannot be deleted.");
});
withdrawalSchema.pre("deleteMany", function () {
  throw new Error("Financial Withdrawal records are immutable and cannot be deleted.");
});

const Withdrawal = mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);
export default Withdrawal;
