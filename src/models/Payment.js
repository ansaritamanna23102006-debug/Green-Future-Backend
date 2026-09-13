import mongoose from "mongoose";
import { PAYMENT_STATUS, PAYMENT_METHODS } from "../utils/rules/orderConstants.js";

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    paymentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.INITIATED,
      index: true,
    },
    amountExpected: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      enum: ["INR", "USDT"],
      default: "INR",
    },
    providerReference: {
      type: String,
      default: null,
      trim: true,
      sparse: true,
      index: true,
    },
    // Data Minimization (Correction 3): strictly normalized verification record
    verification: {
      providerEventId: { type: String, default: null, trim: true },
      providerReference: { type: String, default: null, trim: true },
      verifiedAmount: { type: Number, default: 0 },
      verifiedCurrency: { type: String, default: null },
      verificationTimestamp: { type: Date, default: null },
      verificationStatus: {
        type: String,
        enum: ["VERIFIED", "FAILED", "MISMATCH", "PENDING"],
        default: "PENDING",
      },
    },
    isSandbox: {
      type: Boolean,
      default: false,
    },
    disclaimer: {
      type: String,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
