/**
 * Green Future Tech (GFT) — Authoritative Activation Service
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Record
 * 
 * Enforces:
 * 1. requireVerifiedKyc gate (User must have APPROVED KYC)
 * 2. Phase 0 assertRuleExecutable gate (Package must be CONFIRMED)
 * 3. ACTIVATION_BLOCKED lifecycle with zero financial side effects
 * 4. Strict side-effect prohibition: zero commission, zero leg volume, zero wallet payouts.
 */

import User from "../models/User.js";
import Order from "../models/Order.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import {
  ORDER_STATUS,
  ACTIVATION_STATUS,
  isAllowedOrderTransition,
} from "../utils/rules/orderConstants.js";
import { KYC_STATUS } from "../utils/rules/kycConstants.js";
import {
  isRuleExecutable,
  assertRuleExecutable,
} from "../utils/rules/businessPlanConfig.js";

class ActivationService {
  /**
   * Evaluates activation readiness for a paid order.
   * Does NOT bypass Phase 0 execution gates or KYC gates.
   */
  async evaluateActivation(order, user, reqInfo = {}) {
    if (!order) throw new AppError("Order not found", 404);

    // Idempotency: If already activated, return immediately without re-execution
    if (order.orderStatus === ORDER_STATUS.ACTIVATED) {
      return {
        activated: true,
        alreadyActivated: true,
        order,
        message: "Order is already activated.",
      };
    }

    // Refresh user object from DB if necessary
    let currentUser = user;
    if (!currentUser.kyc || !currentUser.save) {
      currentUser = await User.findOne({ userId: order.userId });
    }
    if (!currentUser) throw new AppError("User record not found", 404);

    if (!order.activationDetails) order.activationDetails = {};
    if (!order.history) order.history = [];

    // Tier 1 Check: KYC Gate (Correction 5)
    const isKycApproved = currentUser.kyc && currentUser.kyc.status === KYC_STATUS.APPROVED;
    if (!isKycApproved) {
      order.orderStatus = ORDER_STATUS.ACTIVATION_BLOCKED;
      order.activationStatus = ACTIVATION_STATUS.BLOCKED_KYC_REQUIRED;
      order.activationDetails.blockedReason = "Approved KYC verification is mandatory before package activation.";
      order.history.push({
        action: "ACTIVATION_BLOCKED",
        previousStatus: ORDER_STATUS.PAID,
        newStatus: ORDER_STATUS.ACTIVATION_BLOCKED,
        changedBy: currentUser.userId,
        timestamp: new Date(),
        details: "Activation blocked: Member KYC status is not APPROVED.",
      });
      await order.save();

      await AuditLog.create({
        userId: currentUser.userId,
        action: "ACTIVATION_BLOCKED",
        ipAddress: reqInfo.ip || "",
        userAgent: reqInfo.userAgent || "",
        details: `Activation blocked for order ${order.orderId}: KYC status '${currentUser.kyc ? currentUser.kyc.status : "NOT_STARTED"}' is not APPROVED. Zero financial side-effects executed.`,
      });

      return {
        activated: false,
        blocked: true,
        reason: "KYC_VERIFICATION_REQUIRED",
        order,
        message: "Payment confirmed, but package activation is paused pending compliance KYC verification.",
      };
    }

    // Tier 2 Check: Phase 0 Business Plan Execution Gate (Correction 1 & 5)
    const packageKey = order.packageSnapshot.packageId;
    const isExecutable = isRuleExecutable(packageKey);

    if (!isExecutable) {
      order.orderStatus = ORDER_STATUS.ACTIVATION_BLOCKED;
      order.activationStatus = ACTIVATION_STATUS.BLOCKED_UNCONFIRMED_RULE;
      order.activationDetails.blockedReason = `Package business rule '${packageKey}' is currently pending client confirmation (status: REQUIRES_CLIENT_CONFIRMATION). Live activation is paused.`;
      order.history.push({
        action: "ACTIVATION_BLOCKED",
        previousStatus: ORDER_STATUS.PAID,
        newStatus: ORDER_STATUS.ACTIVATION_BLOCKED,
        changedBy: currentUser.userId,
        timestamp: new Date(),
        details: `Activation blocked: Package ${packageKey} confirmationStatus is REQUIRES_CLIENT_CONFIRMATION.`,
      });
      await order.save();

      await AuditLog.create({
        userId: currentUser.userId,
        action: "ACTIVATION_BLOCKED",
        ipAddress: reqInfo.ip || "",
        userAgent: reqInfo.userAgent || "",
        details: `Activation blocked for order ${order.orderId}: Package ${packageKey} is unconfirmed. Zero financial side-effects executed.`,
      });

      return {
        activated: false,
        blocked: true,
        reason: "UNCONFIRMED_BUSINESS_RULE",
        order,
        message: "Payment confirmed, but package activation is paused because package rules require client confirmation.",
      };
    }

    // Both Tier 1 (KYC) and Tier 2 (Phase 0) have legitimately passed!
    const now = new Date();
    const durationMonths = order.packageSnapshot.durationMonths || 12;
    const expiresAt = new Date(now.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);

    order.orderStatus = ORDER_STATUS.ACTIVATED;
    order.activationStatus = ACTIVATION_STATUS.ACTIVATED;
    order.activationDetails.activatedAt = now;
    order.activationDetails.expiresAt = expiresAt;
    order.activationDetails.unblockedAt = now;
    order.history.push({
      action: "PACKAGE_ACTIVATED",
      previousStatus: order.orderStatus,
      newStatus: ORDER_STATUS.ACTIVATED,
      changedBy: currentUser.userId,
      timestamp: now,
      details: `Package ${order.packageSnapshot.name} activated successfully (Validity: ${durationMonths} months).`,
    });
    await order.save();

    // Record authoritative activation on User
    currentUser.status = "active";
    currentUser.activePackage = {
      packageId: order.packageSnapshot.packageId,
      packageKey: order.packageSnapshot.packageId,
      name: order.packageSnapshot.name,
      amount: order.amount,
      currency: order.currency,
      orderId: order.orderId,
      activatedAt: now,
      expiresAt,
      status: "ACTIVE",
    };

    if (!Array.isArray(currentUser.packageHistory)) {
      currentUser.packageHistory = [];
    }
    currentUser.packageHistory.push({
      packageKey: order.packageSnapshot.packageId,
      orderId: order.orderId,
      name: order.packageSnapshot.name,
      amount: order.amount,
      currency: order.currency,
      activatedAt: now,
      expiresAt,
      status: "ACTIVATED",
    });

    await currentUser.save();

    // Audit Logging
    await AuditLog.create({
      userId: currentUser.userId,
      action: "PACKAGE_ACTIVATED",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `Order ${order.orderId} activated package ${order.packageSnapshot.name} for user ${currentUser.userId}. Expiry: ${expiresAt.toISOString()}.`,
    });

    // NOTE: In strict adherence to Phase 3 Side-Effect Prohibition Rules,
    // NO direct income, binary matching, passive turnover, or token distributions are triggered here.
    // Those belong to Phase 4, Phase 5, and Phase 6.

    return {
      activated: true,
      blocked: false,
      order,
      activePackage: currentUser.activePackage,
      message: "Package activated successfully.",
    };
  }
}

const activationService = new ActivationService();
export default activationService;
