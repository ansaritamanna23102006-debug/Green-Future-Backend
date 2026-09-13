/**
 * Green Future Tech (GFT) — Authoritative Order & Payment Constants
 * Phase 3: Package -> Order -> Payment -> Verification -> Activation Lifecycle Engine
 */

export const ORDER_STATUS = Object.freeze({
  CREATED: "CREATED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  ACTIVATION_PENDING: "ACTIVATION_PENDING",
  ACTIVATION_BLOCKED: "ACTIVATION_BLOCKED",
  ACTIVATED: "ACTIVATED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
});

export const PAYMENT_STATUS = Object.freeze({
  INITIATED: "INITIATED",
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
});

export const ACTIVATION_STATUS = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  PENDING: "PENDING",
  BLOCKED_KYC_REQUIRED: "BLOCKED_KYC_REQUIRED",
  BLOCKED_UNCONFIRMED_RULE: "BLOCKED_UNCONFIRMED_RULE",
  ACTIVATED: "ACTIVATED",
  FAILED: "FAILED",
});

export const PAYMENT_METHODS = Object.freeze({
  SANDBOX_MOCK_ADAPTER: "SANDBOX_MOCK_ADAPTER",
  CRYPTO_USDT_MANUAL: "CRYPTO_USDT_MANUAL",
  GATEWAY_EXTERNAL: "GATEWAY_EXTERNAL",
});

/**
 * Validates permissible Order state machine transitions.
 */
export function isAllowedOrderTransition(currentStatus, targetStatus) {
  if (currentStatus === targetStatus) return true;

  const validTransitions = {
    [ORDER_STATUS.CREATED]: [
      ORDER_STATUS.PAYMENT_PENDING,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.EXPIRED,
    ],
    [ORDER_STATUS.PAYMENT_PENDING]: [
      ORDER_STATUS.PAYMENT_PROCESSING,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.EXPIRED,
    ],
    [ORDER_STATUS.PAYMENT_PROCESSING]: [
      ORDER_STATUS.PAID,
      ORDER_STATUS.FAILED,
      ORDER_STATUS.PAYMENT_PENDING,
    ],
    [ORDER_STATUS.PAID]: [
      ORDER_STATUS.ACTIVATION_PENDING,
      ORDER_STATUS.ACTIVATION_BLOCKED,
      ORDER_STATUS.ACTIVATED,
    ],
    [ORDER_STATUS.ACTIVATION_PENDING]: [
      ORDER_STATUS.ACTIVATION_BLOCKED,
      ORDER_STATUS.ACTIVATED,
      ORDER_STATUS.FAILED,
    ],
    [ORDER_STATUS.ACTIVATION_BLOCKED]: [
      ORDER_STATUS.ACTIVATION_PENDING,
      ORDER_STATUS.ACTIVATED,
    ],
    [ORDER_STATUS.ACTIVATED]: [], // Terminal state
    [ORDER_STATUS.FAILED]: [],    // Terminal state
    [ORDER_STATUS.CANCELLED]: [], // Terminal state
    [ORDER_STATUS.EXPIRED]: [],   // Terminal state
  };

  const allowed = validTransitions[currentStatus] || [];
  return allowed.includes(targetStatus);
}

/**
 * Validates permissible Payment state machine transitions (Option A).
 */
export function isAllowedPaymentTransition(currentStatus, targetStatus) {
  if (currentStatus === targetStatus) return true;

  const validTransitions = {
    [PAYMENT_STATUS.INITIATED]: [
      PAYMENT_STATUS.PENDING,
      PAYMENT_STATUS.FAILED,
      PAYMENT_STATUS.REJECTED,
    ],
    [PAYMENT_STATUS.PENDING]: [
      PAYMENT_STATUS.CONFIRMED,
      PAYMENT_STATUS.FAILED,
      PAYMENT_STATUS.REJECTED,
    ],
    [PAYMENT_STATUS.CONFIRMED]: [], // Terminal successful state
    [PAYMENT_STATUS.FAILED]: [],    // Terminal failure state
    [PAYMENT_STATUS.REJECTED]: [],  // Terminal rejection state
  };

  const allowed = validTransitions[currentStatus] || [];
  return allowed.includes(targetStatus);
}
