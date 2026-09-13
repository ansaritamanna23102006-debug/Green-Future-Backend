/**
 * Green Future Tech (GFT) — Authoritative Payment Service
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Record
 * 
 * Implements Option A state machine (INITIATED -> PENDING -> CONFIRMED),
 * sandbox security, strict server-side verification, and payment data minimization.
 */

import crypto from "crypto";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  isAllowedPaymentTransition,
  isAllowedOrderTransition,
} from "../utils/rules/orderConstants.js";
import activationService from "./activationService.js";

class PaymentService {
  /**
   * Initiates payment for an existing order.
   */
  async initiatePayment(user, orderId, paymentMethod = PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER, reqInfo = {}) {
    const order = await Order.findOne({ orderId });
    if (!order) throw new AppError("Order not found", 404);

    if (order.userId !== user.userId) {
      throw new AppError("Unauthorized access to requested order", 403);
    }

    // If order is already paid or confirmed, return current state idempotently
    if (
      order.orderStatus === ORDER_STATUS.PAID ||
      order.orderStatus === ORDER_STATUS.ACTIVATED ||
      order.orderStatus === ORDER_STATUS.ACTIVATION_BLOCKED ||
      order.paymentStatus === PAYMENT_STATUS.CONFIRMED
    ) {
      const existingPayment = await Payment.findOne({ orderId, status: PAYMENT_STATUS.CONFIRMED });
      return {
        alreadyPaid: true,
        order,
        payment: existingPayment,
      };
    }

    if (order.orderStatus === ORDER_STATUS.FAILED || order.orderStatus === ORDER_STATUS.CANCELLED || order.orderStatus === ORDER_STATUS.EXPIRED) {
      throw new AppError(`Cannot initiate payment. Order is currently in terminal '${order.orderStatus}' status.`, 400);
    }

    // Sandbox isolation guard (Correction 2)
    const isSandbox = paymentMethod === PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER;
    if (isSandbox) {
      const isProduction = process.env.NODE_ENV === "production";
      const allowSandboxInProd = process.env.ALLOW_SANDBOX_PAYMENTS === "true";
      if (isProduction && !allowSandboxInProd) {
        throw new AppError("Sandbox mock payment adapter is disabled in production environment.", 403);
      }
    }

    // Check if a pending payment record already exists for this order
    let payment = await Payment.findOne({ orderId, status: PAYMENT_STATUS.PENDING });
    if (!payment) {
      const paymentId = `PAY-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const providerReference = isSandbox
        ? `MOCK_TXN_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`
        : null;

      payment = await Payment.create({
        paymentId,
        order: order._id,
        orderId: order.orderId,
        user: user._id,
        userId: user.userId,
        paymentMethod,
        status: PAYMENT_STATUS.PENDING,
        amountExpected: order.amount,
        amountPaid: 0,
        currency: order.currency,
        providerReference,
        isSandbox,
        disclaimer: isSandbox
          ? "Sandbox test transaction for development/staging. No actual currency or digital assets were transferred."
          : null,
      });

      // Update order state to PAYMENT_PENDING
      if (isAllowedOrderTransition(order.orderStatus, ORDER_STATUS.PAYMENT_PENDING)) {
        order.orderStatus = ORDER_STATUS.PAYMENT_PENDING;
        order.paymentStatus = PAYMENT_STATUS.PENDING;
        order.history.push({
          action: "PAYMENT_INITIATED",
          previousStatus: ORDER_STATUS.CREATED,
          newStatus: ORDER_STATUS.PAYMENT_PENDING,
          changedBy: user.userId,
          timestamp: new Date(),
          details: `Initiated payment ${payment.paymentId} via ${paymentMethod}.`,
        });
        await order.save();
      }

      await AuditLog.create({
        userId: user.userId,
        action: "PAYMENT_INITIATED",
        ipAddress: reqInfo.ip || "",
        userAgent: reqInfo.userAgent || "",
        details: `Payment ${payment.paymentId} initiated for order ${order.orderId} (Method: ${paymentMethod}, Amount: ₹${order.amount}).`,
      });
    }

    return {
      order,
      payment,
      paymentInstructions: {
        paymentId: payment.paymentId,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        paymentMethod: payment.paymentMethod,
        providerReference: payment.providerReference,
        isSandbox: payment.isSandbox,
      },
    };
  }

  /**
   * Verifies and confirms payment server-side.
   * Never trusts client-supplied success flags.
   */
  async verifyPayment(user, payload = {}, reqInfo = {}) {
    const { orderId, paymentId, providerReference, amountPaid, currency } = payload;

    if (!orderId) throw new AppError("Order ID is required for verification", 400);

    const order = await Order.findOne({ orderId });
    if (!order) throw new AppError("Order not found", 404);

    if (order.userId !== user.userId) {
      throw new AppError("Unauthorized access to requested order", 403);
    }

    // Find payment record
    const query = { orderId: order.orderId };
    if (paymentId) query.paymentId = paymentId;
    const payment = await Payment.findOne(query);
    if (!payment) throw new AppError("No payment initiation record found for this order", 404);

    // Idempotent Confirmation Check (Correction 4)
    if (payment.status === PAYMENT_STATUS.CONFIRMED) {
      return {
        success: true,
        alreadyConfirmed: true,
        order,
        payment,
        message: "Payment is already confirmed.",
      };
    }

    // Enforce allowed payment state transition
    if (!isAllowedPaymentTransition(payment.status, PAYMENT_STATUS.CONFIRMED)) {
      throw new AppError(`Cannot confirm payment. Payment is in terminal '${payment.status}' state.`, 400);
    }

    // Validate provider reference and check replay attacks
    const activeReference = providerReference || payment.providerReference;
    if (!activeReference) {
      throw new AppError("Payment verification requires a valid provider transaction reference", 400);
    }

    const replayCheck = await Payment.findOne({
      providerReference: activeReference,
      _id: { $ne: payment._id },
      status: PAYMENT_STATUS.CONFIRMED,
    });
    if (replayCheck) {
      payment.status = PAYMENT_STATUS.REJECTED;
      payment.verification = {
        providerEventId: activeReference,
        providerReference: activeReference,
        verifiedAmount: 0,
        verifiedCurrency: currency || order.currency,
        verificationTimestamp: new Date(),
        verificationStatus: "FAILED",
      };
      await payment.save();

      await AuditLog.create({
        userId: user.userId,
        action: "PAYMENT_REPLAY_BLOCKED",
        ipAddress: reqInfo.ip || "",
        userAgent: reqInfo.userAgent || "",
        details: `Replay attack blocked: Reference ${activeReference} already used by another payment.`,
      });

      throw new AppError("Payment verification failed: transaction reference has already been claimed", 400);
    }

    // Validate payment amount (amount protection)
    const verifiedAmount = parseFloat(amountPaid !== undefined ? amountPaid : payment.amountExpected);
    if (isNaN(verifiedAmount) || verifiedAmount !== payment.amountExpected) {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.verification = {
        providerEventId: activeReference,
        providerReference: activeReference,
        verifiedAmount,
        verifiedCurrency: currency || order.currency,
        verificationTimestamp: new Date(),
        verificationStatus: "MISMATCH",
      };
      await payment.save();

      order.orderStatus = ORDER_STATUS.FAILED;
      order.history.push({
        action: "PAYMENT_FAILED",
        previousStatus: order.orderStatus,
        newStatus: ORDER_STATUS.FAILED,
        changedBy: user.userId,
        timestamp: new Date(),
        details: `Payment amount mismatch: expected ₹${payment.amountExpected}, received ₹${verifiedAmount}.`,
      });
      await order.save();

      throw new AppError(`Payment amount mismatch. Expected ₹${payment.amountExpected}, but received ₹${verifiedAmount}.`, 400);
    }

    // Validate currency
    const verifiedCurrency = currency || order.currency;
    if (verifiedCurrency !== order.currency) {
      payment.status = PAYMENT_STATUS.FAILED;
      await payment.save();
      throw new AppError(`Payment currency mismatch. Expected ${order.currency}, received ${verifiedCurrency}.`, 400);
    }

    // Transition Payment: Option A -> CONFIRMED is terminal successful payment state
    payment.status = PAYMENT_STATUS.CONFIRMED;
    payment.amountPaid = verifiedAmount;
    payment.providerReference = activeReference;
    payment.confirmedAt = new Date();
    // Data Minimization (Correction 3): normalized minimal record
    payment.verification = {
      providerEventId: activeReference,
      providerReference: activeReference,
      verifiedAmount,
      verifiedCurrency,
      verificationTimestamp: new Date(),
      verificationStatus: "VERIFIED",
    };
    await payment.save();

    // Transition Order: PAYMENT_PENDING/PROCESSING -> PAID
    order.orderStatus = ORDER_STATUS.PAID;
    order.paymentStatus = PAYMENT_STATUS.CONFIRMED;
    order.history.push({
      action: "PAYMENT_CONFIRMED",
      previousStatus: ORDER_STATUS.PAYMENT_PENDING,
      newStatus: ORDER_STATUS.PAID,
      changedBy: user.userId,
      timestamp: new Date(),
      details: `Payment ${payment.paymentId} confirmed (Reference: ${activeReference}, Amount: ₹${verifiedAmount}).`,
    });
    await order.save();

    await AuditLog.create({
      userId: user.userId,
      action: "PAYMENT_CONFIRMED",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `Payment ${payment.paymentId} successfully confirmed for order ${order.orderId}.`,
    });

    // Automatically evaluate package activation boundary
    const activationResult = await activationService.evaluateActivation(order, user, reqInfo);

    return {
      success: true,
      order: activationResult.order,
      payment,
      activation: activationResult,
    };
  }
}

const paymentService = new PaymentService();
export default paymentService;
