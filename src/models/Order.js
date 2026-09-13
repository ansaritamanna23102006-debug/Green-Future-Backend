import mongoose from "mongoose";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  ACTIVATION_STATUS,
} from "../utils/rules/orderConstants.js";

const { Schema } = mongoose;

const orderSchema = new Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
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
    packageId: {
      type: String,
      required: true,
      trim: true,
    },
    packageSnapshot: {
      packageId: { type: String, required: true },
      name: { type: String, required: true },
      category: { type: String, default: "General" },
      amount: { type: Number, required: true },
      currency: { type: String, default: "INR" },
      durationMonths: { type: Number, default: 12 },
      lockInDays: { type: Number, default: 365 },
      configVersion: { type: String, default: "BUSINESS_PLAN_DRAFT_V0" },
      confirmationStatus: { type: String, required: true },
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ["INR", "USDT"],
      default: "INR",
    },
    orderStatus: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.CREATED,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.INITIATED,
    },
    activationStatus: {
      type: String,
      enum: Object.values(ACTIVATION_STATUS),
      default: ACTIVATION_STATUS.NOT_APPLICABLE,
    },
    activationDetails: {
      activatedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      blockedReason: { type: String, default: null },
      unblockedAt: { type: Date, default: null },
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
    },
    isSandbox: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 60 * 1000), // 60 minutes
      index: true,
    },
    history: [
      {
        action: { type: String, required: true },
        previousStatus: { type: String },
        newStatus: { type: String },
        changedBy: { type: String },
        timestamp: { type: Date, default: Date.now },
        details: { type: String },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound sparse index on userId and idempotencyKey to prevent duplicate order creation
orderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const Order = mongoose.model("Order", orderSchema);
export default Order;
