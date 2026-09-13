/**
 * Green Future Tech (GFT) — Order & Payment Controller
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Record
 */

import orderService from "../services/orderService.js";
import paymentService from "../services/paymentService.js";
import { successResponse } from "../utils/response.js";
import AppError from "../utils/errors.js";

export const createOrder = async (req, res, next) => {
  try {
    const { packageId, idempotencyKey, isSandbox } = req.body;
    const reqInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const order = await orderService.createOrder({
      user: req.user,
      packageId,
      idempotencyKey: idempotencyKey || req.headers["idempotency-key"] || null,
      isSandbox: Boolean(isSandbox),
      reqInfo,
    });

    return successResponse(res, order, "Order created successfully", 201);
  } catch (error) {
    next(error);
  }
};

export const getMyOrders = async (req, res, next) => {
  try {
    const result = await orderService.getUserOrders(req.user, req.query);
    return successResponse(res, result, "User orders fetched successfully");
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await orderService.getOrderById(req.user, orderId);
    return successResponse(res, order, "Order retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const initiatePayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod } = req.body;
    const reqInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const result = await paymentService.initiatePayment(
      req.user,
      orderId,
      paymentMethod,
      reqInfo
    );

    return successResponse(res, result, "Payment session initiated successfully");
  } catch (error) {
    next(error);
  }
};

export const verifyPayment = async (req, res, next) => {
  try {
    const reqInfo = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    const result = await paymentService.verifyPayment(req.user, req.body, reqInfo);
    return successResponse(res, result, result.message || "Payment verified successfully");
  } catch (error) {
    next(error);
  }
};

export const getAdminOrderQueue = async (req, res, next) => {
  try {
    const result = await orderService.getAdminOrderQueue(req.user, req.query);
    return successResponse(res, result, "Admin order queue fetched successfully");
  } catch (error) {
    next(error);
  }
};
