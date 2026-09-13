import mongoose from "mongoose";
import { JOURNAL_STATUS, JOURNAL_EVENT_TYPES } from "../utils/rules/ledgerConstants.js";

const journalEntrySchema = new mongoose.Schema(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: Object.values(JOURNAL_EVENT_TYPES),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(JOURNAL_STATUS),
      default: JOURNAL_STATUS.PENDING,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound index on referenceId + eventType
journalEntrySchema.index({ referenceId: 1, eventType: 1 });
journalEntrySchema.index({ createdAt: -1 });

// Immutability Guard: Prohibit deletion completely
journalEntrySchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Fatal: JournalEntry records are permanently immutable and cannot be deleted.");
});

// Immutability Guard: Protect against arbitrary mutation of core fields
journalEntrySchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  const update = this.getUpdate();
  if (!update) return;

  const setObj = update.$set || update;
  const setKeys = Object.keys(setObj);

  // Core financial identifiers are strictly immutable
  const forbiddenFields = ["idempotencyKey", "referenceId", "eventType", "_id"];
  const touchesForbidden = setKeys.some((k) => forbiddenFields.includes(k));
  if (touchesForbidden) {
    throw new Error("Fatal: Core financial identifiers on JournalEntry are immutable.");
  }
});

const JournalEntry = mongoose.model("JournalEntry", journalEntrySchema);
export default JournalEntry;
