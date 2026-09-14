import mongoose from "mongoose";
import { INCOME_TYPES } from "../services/income/incomeConstants.js";

const incomeSnapshotSchema = new mongoose.Schema(
  {
    beneficiaryUserId: {
      type: String,
      required: true,
      index: true,
    },
    sourceUserId: {
      type: String,
      required: true,
      index: true,
    },
    incomeType: {
      type: String,
      enum: Object.values(INCOME_TYPES),
      required: true,
      index: true,
    },
    level: {
      type: Number,
      default: null,
    },
    rank: {
      type: String,
      default: null,
    },
    tier: {
      type: Number,
      default: null,
    },
    baseAmountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    rateBasisPoints: {
      type: Number,
      required: true,
      min: 0,
    },
    calculatedAmountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ruleVersion: {
      type: String,
      required: true,
    },
    ruleStatus: {
      type: String,
      required: true,
    },
    genealogySnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    packageSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    rankSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    calculationDate: {
      type: Date,
      default: Date.now,
    },
    calculatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying beneficiary historical calculations
incomeSnapshotSchema.index({ beneficiaryUserId: 1, incomeType: 1, createdAt: -1 });

// ==========================================
// IMMUTABILITY GUARDS
// ==========================================

incomeSnapshotSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("Fatal: IncomeSnapshot records are permanently immutable and cannot be updated."));
  }
  next();
});

incomeSnapshotSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  throw new Error("Fatal: IncomeSnapshot records are permanently immutable and cannot be updated.");
});

incomeSnapshotSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Fatal: IncomeSnapshot records are permanently immutable and cannot be deleted.");
});

const IncomeSnapshot = mongoose.model("IncomeSnapshot", incomeSnapshotSchema);
export default IncomeSnapshot;
