import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Phase 4: Authoritative integer minor-unit balance projections (Paisa)
    availablePaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarnedPaisa: {
      type: Number,
      default: 0,
    },
    version: {
      type: Number,
      default: 1,
      required: true,
    },
    reconciliationMismatch: {
      type: Boolean,
      default: false,
    },

    // Legacy fields preserved strictly for read-only backwards compatibility
    incomeWallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    tokenWallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    withdrawalWallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarned: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Wallet = mongoose.model("Wallet", walletSchema);
export default Wallet;
