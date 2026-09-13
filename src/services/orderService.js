/**
 * Green Future Tech (GFT) — Authoritative Order Service
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Record
 * 
 * Enforces businessPlanConfig.js as the SINGLE SOURCE OF TRUTH for executable terms.
 */

import crypto from "crypto";
import Order from "../models/Order.js";
import Package from "../models/Package.js";
import AuditLog from "../models/AuditLog.js";
import AppError from "../utils/errors.js";
import {
  PACKAGES,
  RULE_VERSION,
  getRuleConfig,
} from "../utils/rules/businessPlanConfig.js";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  ACTIVATION_STATUS,
  isAllowedOrderTransition,
} from "../utils/rules/orderConstants.js";

class OrderService {
  /**
   * Resolves authoritative package definition.
   * Single Source of Truth: businessPlanConfig.js wins.
   */
  resolvePackageDefinition(packageKey) {
    // 1. First check Phase 0 authoritative configuration
    if (PACKAGES[packageKey]) {
      const cfg = PACKAGES[packageKey];
      const authoritativeAmount = cfg.discrepancy?.pdfPrice || cfg.amount || 3000;
      return {
        packageId: cfg.packageId,
        name: cfg.name,
        category: cfg.category || "Student",
        amount: authoritativeAmount,
        currency: "INR",
        durationMonths: cfg.durationMonths || 12,
        lockInDays: cfg.lockInDays || 365,
        configVersion: RULE_VERSION,
        confirmationStatus: cfg.confirmationStatus,
      };
    }

    // 2. Check if key is a known alias in PACKAGES by name
    const foundByAlias = Object.values(PACKAGES).find(
      (p) => p.name.toLowerCase() === String(packageKey).toLowerCase()
    );
    if (foundByAlias) {
      const authoritativeAmount = foundByAlias.discrepancy?.pdfPrice || foundByAlias.amount || 3000;
      return {
        packageId: foundByAlias.packageId,
        name: foundByAlias.name,
        category: foundByAlias.category || "Student",
        amount: authoritativeAmount,
        currency: "INR",
        durationMonths: foundByAlias.durationMonths || 12,
        lockInDays: foundByAlias.lockInDays || 365,
        configVersion: RULE_VERSION,
        confirmationStatus: foundByAlias.confirmationStatus,
      };
    }

    return null;
  }

  /**
   * Creates an immutable order.
   * Does NOT trust client price, currency, duration, or status.
   */
  async createOrder({ user, packageId, idempotencyKey = null, isSandbox = false, reqInfo = {} }) {
    if (!user || !user.userId) {
      throw new AppError("Authentication required to create an order", 401);
    }

    if (!packageId) {
      throw new AppError("Package identifier is required", 400);
    }

    // Idempotency: return existing order if same idempotencyKey was already submitted by user
    if (idempotencyKey) {
      const existing = await Order.findOne({ userId: user.userId, idempotencyKey });
      if (existing) {
        return existing;
      }
    }

    // Resolve authoritative package snapshot
    let snapshot = this.resolvePackageDefinition(packageId);

    // If not found in Phase 0 config, check database catalog as fallback
    if (!snapshot) {
      try {
        const dbPkg = await Package.findOne({
          $or: [{ packageId }, { _id: packageId.match(/^[0-9a-fA-F]{24}$/) ? packageId : null }],
        });
        if (dbPkg) {
          snapshot = {
            packageId: dbPkg.packageId || dbPkg._id.toString(),
            name: dbPkg.name,
            category: dbPkg.category || "General",
            amount: dbPkg.price,
            currency: "INR",
            durationMonths: dbPkg.durationMonths || 12,
            lockInDays: dbPkg.lockInDays || 365,
            configVersion: "CATALOG_PROJECTION_V0",
            confirmationStatus: dbPkg.confirmationStatus || "REQUIRES_CLIENT_CONFIRMATION",
          };
        }
      } catch (err) {
        // Continue to not found check
      }
    }

    if (!snapshot) {
      throw new AppError(`Invalid or unrecognized package identifier: '${packageId}'`, 404);
    }

    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const order = await Order.create({
      orderId,
      user: user._id,
      userId: user.userId,
      packageId: snapshot.packageId,
      packageSnapshot: snapshot,
      amount: snapshot.amount,
      currency: snapshot.currency,
      orderStatus: ORDER_STATUS.CREATED,
      paymentStatus: PAYMENT_STATUS.INITIATED,
      activationStatus: ACTIVATION_STATUS.NOT_APPLICABLE,
      idempotencyKey: idempotencyKey || null,
      isSandbox: Boolean(isSandbox),
      history: [
        {
          action: "ORDER_CREATED",
          previousStatus: null,
          newStatus: ORDER_STATUS.CREATED,
          changedBy: user.userId,
          timestamp: new Date(),
          details: `Order created for package ${snapshot.name} (Amount: ₹${snapshot.amount}).`,
        },
      ],
    });

    await AuditLog.create({
      userId: user.userId,
      action: "ORDER_CREATED",
      ipAddress: reqInfo.ip || "",
      userAgent: reqInfo.userAgent || "",
      details: `User created order ${order.orderId} for package ${snapshot.packageId} (Authoritative Amount: ₹${snapshot.amount}).`,
    });

    return order;
  }

  /**
   * Retrieves single order by ID with strict ownership validation.
   */
  async getOrderById(requestingUser, orderId) {
    const order = await Order.findOne({ orderId });
    if (!order) throw new AppError("Order not found", 404);

    const isStaff = requestingUser.role === "admin" || requestingUser.role === "superadmin";
    if (!isStaff && order.userId !== requestingUser.userId) {
      throw new AppError("Unauthorized access to requested order", 403);
    }

    return order;
  }

  /**
   * Retrieves paginated orders for a specific user.
   */
  async getUserOrders(user, query = {}) {
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const skip = (page - 1) * limit;

    const filter = { userId: user.userId };
    if (query.orderStatus) filter.orderStatus = query.orderStatus;

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin queue retrieval.
   */
  async getAdminOrderQueue(adminUser, query = {}) {
    const isStaff = adminUser.role === "admin" || adminUser.role === "superadmin";
    if (!isStaff) throw new AppError("Administrative privilege required", 403);

    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.orderStatus && query.orderStatus !== "ALL") filter.orderStatus = query.orderStatus;
    if (query.paymentStatus && query.paymentStatus !== "ALL") filter.paymentStatus = query.paymentStatus;
    if (query.search) {
      filter.$or = [
        { orderId: { $regex: query.search, $options: "i" } },
        { userId: { $regex: query.search, $options: "i" } },
      ];
    }

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

const orderService = new OrderService();
export default orderService;
