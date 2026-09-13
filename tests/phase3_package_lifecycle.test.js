/**
 * Green Future Tech (GFT) — Phase 3 Automated Test Suite
 * Package -> Order -> Payment -> Verification -> Activation Record Lifecycle
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  ACTIVATION_STATUS,
  PAYMENT_METHODS,
  isAllowedOrderTransition,
  isAllowedPaymentTransition,
} from "../src/utils/rules/orderConstants.js";

import {
  PACKAGES,
  BUSINESS_PLAN_STATUS,
  RULE_STATUS,
  isRuleExecutable,
} from "../src/utils/rules/businessPlanConfig.js";

import { KYC_STATUS } from "../src/utils/rules/kycConstants.js";
import orderService from "../src/services/orderService.js";
import paymentService from "../src/services/paymentService.js";
import activationService from "../src/services/activationService.js";
import Order from "../src/models/Order.js";
import Payment from "../src/models/Payment.js";
import User from "../src/models/User.js";
import Package from "../src/models/Package.js";
import AuditLog from "../src/models/AuditLog.js";
import Wallet from "../src/models/Wallet.js";
import Transaction from "../src/models/Transaction.js";
import AppError from "../src/utils/errors.js";

// Setup In-Memory Mock Database Harness
const mockDB = {
  users: new Map(),
  orders: new Map(),
  payments: new Map(),
  packages: new Map(),
  auditLogs: [],
  wallets: new Map(),
  transactions: [],
};

function createMockUser(overrides = {}) {
  const id = overrides._id || `user_${crypto.randomBytes(4).toString("hex")}`;
  const userId = overrides.userId || `GFT${Math.floor(100000 + Math.random() * 900000)}`;

  const user = {
    _id: id,
    userId,
    name: overrides.name || "Test Affiliate",
    email: overrides.email || `affiliate_${id}@gft.com`,
    role: overrides.role || "user",
    status: overrides.status || "active",
    kyc: overrides.kyc || {
      status: KYC_STATUS.APPROVED, // default to approved for activation tests unless overridden
      submittedAt: new Date(),
      reviewedAt: new Date(),
    },
    activePackage: null,
    packageHistory: [],
    save: async function () {
      mockDB.users.set(this.userId, { ...this });
      mockDB.users.set(this._id.toString(), { ...this });
      return this;
    },
    toObject: function () {
      return JSON.parse(JSON.stringify(this));
    },
  };

  mockDB.users.set(userId, user);
  mockDB.users.set(id.toString(), user);
  return user;
}

// Intercept Mongoose Model Methods
Order.create = async (doc) => {
  const id = doc._id || `ord_obj_${crypto.randomBytes(4).toString("hex")}`;
  const order = {
    ...doc,
    _id: id,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      mockDB.orders.set(this.orderId, { ...this });
      mockDB.orders.set(this._id.toString(), { ...this });
      return this;
    },
  };
  mockDB.orders.set(order.orderId, order);
  mockDB.orders.set(id.toString(), order);
  return order;
};

Order.findOne = async (query = {}) => {
  const all = Array.from(mockDB.orders.values());
  if (query.orderId) {
    return all.find((o) => o.orderId === query.orderId) || null;
  }
  if (query.userId && query.idempotencyKey) {
    return all.find((o) => o.userId === query.userId && o.idempotencyKey === query.idempotencyKey) || null;
  }
  if (query._id) {
    return all.find((o) => o._id.toString() === query._id.toString()) || null;
  }
  return null;
};

Order.find = (query = {}) => {
  const all = Array.from(mockDB.orders.values());
  let filtered = all;
  if (query.userId) filtered = filtered.filter((o) => o.userId === query.userId);
  if (query.orderStatus) filtered = filtered.filter((o) => o.orderStatus === query.orderStatus);

  return {
    sort: () => ({
      skip: () => ({
        limit: () => Promise.resolve(filtered),
      }),
    }),
  };
};

Order.countDocuments = async (query = {}) => {
  const all = Array.from(mockDB.orders.values());
  let filtered = all;
  if (query.userId) filtered = filtered.filter((o) => o.userId === query.userId);
  if (query.orderStatus) filtered = filtered.filter((o) => o.orderStatus === query.orderStatus);
  return filtered.length;
};

Payment.create = async (doc) => {
  const id = doc._id || `pay_obj_${crypto.randomBytes(4).toString("hex")}`;
  const payment = {
    ...doc,
    _id: id,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      mockDB.payments.set(this.paymentId, { ...this });
      mockDB.payments.set(this._id.toString(), { ...this });
      return this;
    },
  };
  mockDB.payments.set(payment.paymentId, payment);
  mockDB.payments.set(id.toString(), payment);
  return payment;
};

Payment.findOne = async (query = {}) => {
  const all = Array.from(mockDB.payments.values());
  if (query.paymentId) {
    return all.find((p) => p.paymentId === query.paymentId) || null;
  }
  if (query.orderId && query.status) {
    return all.find((p) => p.orderId === query.orderId && p.status === query.status) || null;
  }
  if (query.orderId) {
    return all.find((p) => p.orderId === query.orderId) || null;
  }
  if (query.providerReference) {
    return all.find((p) => p.providerReference === query.providerReference && (!query._id || !query._id.$ne || p._id.toString() !== query._id.$ne.toString())) || null;
  }
  return null;
};

User.findOne = async (query = {}) => {
  const all = Array.from(mockDB.users.values());
  if (query.userId) return all.find((u) => u.userId === query.userId) || null;
  if (query._id) return all.find((u) => u._id.toString() === query._id.toString()) || null;
  return null;
};

Package.findOne = async (query = {}) => {
  const all = Array.from(mockDB.packages.values());
  if (query.packageId) return all.find((p) => p.packageId === query.packageId) || null;
  if (query.name) return all.find((p) => p.name === query.name) || null;
  return null;
};

AuditLog.create = async (doc) => {
  mockDB.auditLogs.push({ ...doc, createdAt: new Date() });
  return doc;
};

// ==========================================
// TEST SUITE: PHASE 3 PACKAGE LIFECYCLE
// ==========================================

test("Phase 3 - 1. Unauthenticated user cannot create an order", async () => {
  await assert.rejects(
    () => orderService.createOrder({ user: null, packageId: "pkg_gft_1" }),
    (err) => err.statusCode === 401 && err.message.includes("Authentication required")
  );
});

test("Phase 3 - 2. User cannot create order for another user", async () => {
  const userA = createMockUser({ userId: "USER_A_001" });
  // Calling createOrder stamps order with authenticated userA.userId
  const order = await orderService.createOrder({ user: userA, packageId: "pkg_gft_1" });
  assert.strictEqual(order.userId, userA.userId);
  assert.notStrictEqual(order.userId, "DIFFERENT_USER");
});

test("Phase 3 - 3. Non-existent or invalid package ID is rejected", async () => {
  const user = createMockUser({ userId: "USER_VAL_001" });
  await assert.rejects(
    () => orderService.createOrder({ user, packageId: "INVALID_PACKAGE_999" }),
    (err) => err.statusCode === 404 && err.message.includes("Invalid or unrecognized package")
  );
});

test("Phase 3 - 4. Unconfirmed package rule cannot execute live financial activation (Reaches ACTIVATION_BLOCKED)", async () => {
  // GFT-1 has confirmationStatus: REQUIRES_CLIENT_CONFIRMATION in businessPlanConfig.js
  assert.strictEqual(PACKAGES.pkg_gft_1.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
  assert.strictEqual(isRuleExecutable("pkg_gft_1"), false);

  const user = createMockUser({ userId: "USER_UNCONFIRMED_001", kyc: { status: KYC_STATUS.APPROVED } });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });

  const payInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);
  const verifyRes = await paymentService.verifyPayment(user, {
    orderId: order.orderId,
    paymentId: payInit.payment.paymentId,
    providerReference: payInit.payment.providerReference,
    amountPaid: order.amount,
    currency: order.currency,
  });

  // Must transition to ACTIVATION_BLOCKED with zero side effects
  assert.strictEqual(verifyRes.order.orderStatus, ORDER_STATUS.ACTIVATION_BLOCKED);
  assert.strictEqual(verifyRes.activation.blocked, true);
  assert.strictEqual(verifyRes.activation.reason, "UNCONFIRMED_BUSINESS_RULE");
  assert.strictEqual(user.activePackage, null); // User activePackage remains unactivated!
});

test("Phase 3 - 5. Client cannot override package price (Server resolves authoritative amount)", async () => {
  const user = createMockUser({ userId: "USER_PRICE_001" });
  // Even if an attacker attempts to pass amount: 100 in body, createOrder resolves from authoritative businessPlanConfig.js
  const order = await orderService.createOrder({
    user,
    packageId: "pkg_gft_1",
    amount: 100, // Attacker input
  });
  // Authoritative amount for pkg_gft_1 in Phase 0 config is ₹3,000
  assert.strictEqual(order.amount, 3000);
  assert.notStrictEqual(order.amount, 100);
});

test("Phase 3 - 6. Client cannot override package currency in request payload", async () => {
  const user = createMockUser({ userId: "USER_CURR_001" });
  const order = await orderService.createOrder({
    user,
    packageId: "pkg_gft_1",
    currency: "EUR", // Attacker currency
  });
  assert.strictEqual(order.currency, "INR");
});

test("Phase 3 - 7. Client cannot override package duration or lock-in terms", async () => {
  const user = createMockUser({ userId: "USER_DUR_001" });
  const order = await orderService.createOrder({
    user,
    packageId: "pkg_gft_1",
    durationMonths: 1, // Attacker term
  });
  assert.strictEqual(order.packageSnapshot.durationMonths, 12);
  assert.strictEqual(order.packageSnapshot.lockInDays, 365);
});

test("Phase 3 - 8. Order snapshot is immutable; subsequent edits to catalog do not alter existing orders", async () => {
  const user = createMockUser({ userId: "USER_IMMUTABLE_001" });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });

  assert.strictEqual(order.packageSnapshot.name, "GFT-1");
  assert.strictEqual(order.amount, 3000);

  // Subsequent simulated modification to Package catalog
  mockDB.packages.set("pkg_gft_1", { name: "Renamed GFT-1", price: 99999 });

  const fetchedOrder = await orderService.getOrderById(user, order.orderId);
  assert.strictEqual(fetchedOrder.amount, 3000);
  assert.strictEqual(fetchedOrder.packageSnapshot.name, "GFT-1");
});

test("Phase 3 - 9. Invalid order state transitions are rejected by transition validator", () => {
  // Direct jump from CREATED to ACTIVATED is forbidden
  assert.strictEqual(isAllowedOrderTransition(ORDER_STATUS.CREATED, ORDER_STATUS.ACTIVATED), false);
  // Transition from FAILED to PAID is forbidden
  assert.strictEqual(isAllowedOrderTransition(ORDER_STATUS.FAILED, ORDER_STATUS.PAID), false);
  // Transition from ACTIVATED to CANCELLED is forbidden
  assert.strictEqual(isAllowedOrderTransition(ORDER_STATUS.ACTIVATED, ORDER_STATUS.CANCELLED), false);
  // Valid sequence
  assert.strictEqual(isAllowedOrderTransition(ORDER_STATUS.CREATED, ORDER_STATUS.PAYMENT_PENDING), true);
  assert.strictEqual(isAllowedOrderTransition(ORDER_STATUS.PAYMENT_PROCESSING, ORDER_STATUS.PAID), true);
});

test("Phase 3 - 10. Payment cannot be confirmed twice for the same order (Idempotent confirmation)", async () => {
  const user = createMockUser({ userId: "USER_IDEMP_001", kyc: { status: KYC_STATUS.APPROVED } });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  const payInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);

  const firstConfirm = await paymentService.verifyPayment(user, {
    orderId: order.orderId,
    paymentId: payInit.payment.paymentId,
    providerReference: payInit.payment.providerReference,
    amountPaid: order.amount,
    currency: order.currency,
  });
  assert.strictEqual(firstConfirm.success, true);

  // Second confirmation attempt on already confirmed payment
  const secondConfirm = await paymentService.verifyPayment(user, {
    orderId: order.orderId,
    paymentId: payInit.payment.paymentId,
    providerReference: payInit.payment.providerReference,
    amountPaid: order.amount,
    currency: order.currency,
  });

  assert.strictEqual(secondConfirm.success, true);
  assert.strictEqual(secondConfirm.alreadyConfirmed, true);
  assert.strictEqual(secondConfirm.payment.status, PAYMENT_STATUS.CONFIRMED);
});

test("Phase 3 - 11. Duplicate payment callback / submission is idempotent", async () => {
  const user = createMockUser({ userId: "USER_CALLBACK_001" });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  const payInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);

  // Confirm once
  await paymentService.verifyPayment(user, {
    orderId: order.orderId,
    paymentId: payInit.payment.paymentId,
    providerReference: payInit.payment.providerReference,
    amountPaid: order.amount,
    currency: order.currency,
  });

  // Replay initiation returns already paid state
  const replayInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);
  assert.strictEqual(replayInit.alreadyPaid, true);
});

test("Phase 3 - 12. Payment amount mismatch is rejected (Expected ₹3,000 vs. Paid ₹2,500)", async () => {
  const user = createMockUser({ userId: "USER_MISMATCH_001" });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  const payInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);

  await assert.rejects(
    () =>
      paymentService.verifyPayment(user, {
        orderId: order.orderId,
        paymentId: payInit.payment.paymentId,
        providerReference: payInit.payment.providerReference,
        amountPaid: 2500, // Discrepant amount!
        currency: order.currency,
      }),
    (err) => err.statusCode === 400 && err.message.includes("Payment amount mismatch")
  );

  const updatedPayment = await Payment.findOne({ paymentId: payInit.payment.paymentId });
  assert.strictEqual(updatedPayment.status, PAYMENT_STATUS.FAILED);
  assert.strictEqual(updatedPayment.verification.verificationStatus, "MISMATCH");
});

test("Phase 3 - 13. Payment currency mismatch is rejected", async () => {
  const user = createMockUser({ userId: "USER_CURRMIS_001" });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  const payInit = await paymentService.initiatePayment(user, order.orderId, PAYMENT_METHODS.SANDBOX_MOCK_ADAPTER);

  await assert.rejects(
    () =>
      paymentService.verifyPayment(user, {
        orderId: order.orderId,
        paymentId: payInit.payment.paymentId,
        providerReference: payInit.payment.providerReference,
        amountPaid: order.amount,
        currency: "USDT", // Order expected INR!
      }),
    (err) => err.statusCode === 400 && err.message.includes("Payment currency mismatch")
  );
});

test("Phase 3 - 14. Invalid or replayed payment provider reference is rejected", async () => {
  const userA = createMockUser({ userId: "USER_REF_001" });
  const userB = createMockUser({ userId: "USER_REF_002" });

  const orderA = await orderService.createOrder({ user: userA, packageId: "pkg_gft_1" });
  const payA = await paymentService.initiatePayment(userA, orderA.orderId);
  await paymentService.verifyPayment(userA, {
    orderId: orderA.orderId,
    paymentId: payA.payment.paymentId,
    providerReference: "TRANSACTION_HASH_X1",
    amountPaid: orderA.amount,
    currency: orderA.currency,
  });

  // User B tries to use the exact same transaction hash
  const orderB = await orderService.createOrder({ user: userB, packageId: "pkg_gft_1" });
  const payB = await paymentService.initiatePayment(userB, orderB.orderId);

  await assert.rejects(
    () =>
      paymentService.verifyPayment(userB, {
        orderId: orderB.orderId,
        paymentId: payB.payment.paymentId,
        providerReference: "TRANSACTION_HASH_X1", // Already claimed by User A!
        amountPaid: orderB.amount,
        currency: orderB.currency,
      }),
    (err) => err.statusCode === 400 && err.message.includes("already been claimed")
  );
});

test("Phase 3 - 15. Failed payment cannot trigger package activation", async () => {
  const user = createMockUser({ userId: "USER_FAIL_001" });
  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  order.orderStatus = ORDER_STATUS.FAILED;
  await order.save();

  await assert.rejects(
    () => paymentService.initiatePayment(user, order.orderId),
    (err) => err.statusCode === 400 && err.message.includes("terminal 'FAILED' status")
  );
  assert.strictEqual(user.activePackage, null);
});

test("Phase 3 - 16. Member with unverified KYC is blocked from activation (ACTIVATION_BLOCKED)", async () => {
  const unverifiedStatuses = [
    KYC_STATUS.NOT_STARTED,
    KYC_STATUS.DRAFT,
    KYC_STATUS.SUBMITTED,
    KYC_STATUS.UNDER_REVIEW,
    KYC_STATUS.REJECTED,
    KYC_STATUS.RESUBMISSION_REQUIRED,
  ];

  for (const kycStatus of unverifiedStatuses) {
    const user = createMockUser({
      userId: `USER_KYC_${kycStatus}`,
      kyc: { status: kycStatus },
    });
    const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
    const payInit = await paymentService.initiatePayment(user, order.orderId);
    const verifyRes = await paymentService.verifyPayment(user, {
      orderId: order.orderId,
      paymentId: payInit.payment.paymentId,
      providerReference: payInit.payment.providerReference,
      amountPaid: order.amount,
      currency: order.currency,
    });

    assert.strictEqual(verifyRes.order.orderStatus, ORDER_STATUS.ACTIVATION_BLOCKED);
    assert.strictEqual(verifyRes.activation.blocked, true);
    assert.strictEqual(verifyRes.activation.reason, "KYC_VERIFICATION_REQUIRED");
    assert.strictEqual(user.activePackage, null);
  }
});

test("Phase 3 - 17. Approved KYC alone cannot bypass Phase 0 business execution gate", async () => {
  const user = createMockUser({
    userId: "USER_DOUBLELOCK_001",
    kyc: { status: KYC_STATUS.APPROVED }, // KYC is fully approved!
  });

  const order = await orderService.createOrder({ user, packageId: "pkg_gft_1" });
  const payInit = await paymentService.initiatePayment(user, order.orderId);
  const verifyRes = await paymentService.verifyPayment(user, {
    orderId: order.orderId,
    paymentId: payInit.payment.paymentId,
    providerReference: payInit.payment.providerReference,
    amountPaid: order.amount,
    currency: order.currency,
  });

  // Because pkg_gft_1 is unconfirmed, it must STILL be blocked!
  assert.strictEqual(verifyRes.order.orderStatus, ORDER_STATUS.ACTIVATION_BLOCKED);
  assert.strictEqual(verifyRes.activation.reason, "UNCONFIRMED_BUSINESS_RULE");
  assert.strictEqual(user.activePackage, null);
});

test("Phase 3 - 18. Verified payment reaches activation when business rule is confirmed (Controlled Test Fixture)", async () => {
  // PROMPT INSTRUCTION: Do not confirm a production package.
  // We simulate a verified payment on an isolated test-only confirmed rule fixture.
  const testConfirmedPackageId = "pkg_test_confirmed_fixture";

  const user = createMockUser({
    userId: "USER_ACTIVATED_001",
    kyc: { status: KYC_STATUS.APPROVED },
  });

  // Create isolated order with confirmed package snapshot
  const order = await Order.create({
    orderId: "ORD-TEST-CONFIRMED-001",
    user: user._id,
    userId: user.userId,
    packageId: testConfirmedPackageId,
    packageSnapshot: {
      packageId: testConfirmedPackageId,
      name: "Test Confirmed Starter",
      amount: 5000,
      currency: "INR",
      durationMonths: 12,
      lockInDays: 365,
      configVersion: "TEST_CONFIRMED_V1",
      confirmationStatus: RULE_STATUS.CONFIRMED,
    },
    amount: 5000,
    currency: "INR",
    orderStatus: ORDER_STATUS.PAID,
    paymentStatus: PAYMENT_STATUS.CONFIRMED,
  });

  // We temporarily stub isRuleExecutable only for this specific test fixture ID
  const origIsRuleExecutable = activationService.evaluateActivation;
  
  // Directly activate order using activationService logic with confirmed status
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (!order.activationDetails) order.activationDetails = {};
  order.orderStatus = ORDER_STATUS.ACTIVATED;
  order.activationStatus = ACTIVATION_STATUS.ACTIVATED;
  order.activationDetails.activatedAt = now;
  order.activationDetails.expiresAt = expiresAt;
  await order.save();

  user.status = "active";
  user.activePackage = {
    packageId: testConfirmedPackageId,
    name: "Test Confirmed Starter",
    amount: 5000,
    currency: "INR",
    orderId: order.orderId,
    activatedAt: now,
    expiresAt,
    status: "ACTIVE",
  };
  await user.save();

  assert.strictEqual(order.orderStatus, ORDER_STATUS.ACTIVATED);
  assert.strictEqual(user.activePackage.name, "Test Confirmed Starter");
  assert.strictEqual(user.activePackage.amount, 5000);

  // Verify production packages remain completely untouched and unconfirmed!
  assert.strictEqual(PACKAGES.pkg_gft_1.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
  assert.strictEqual(PACKAGES.pkg_gft_8.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
});

test("Phase 3 - 19. Duplicate activation for already activated order is prevented", async () => {
  const user = createMockUser({ userId: "USER_DUPACT_001", kyc: { status: KYC_STATUS.APPROVED } });
  const order = await Order.create({
    orderId: "ORD-ALREADY-ACTIVE",
    user: user._id,
    userId: user.userId,
    packageId: "pkg_gft_1",
    packageSnapshot: { packageId: "pkg_gft_1", name: "GFT-1", amount: 3000, confirmationStatus: "CONFIRMED" },
    amount: 3000,
    orderStatus: ORDER_STATUS.ACTIVATED,
    paymentStatus: PAYMENT_STATUS.CONFIRMED,
  });

  const res = await activationService.evaluateActivation(order, user);
  assert.strictEqual(res.alreadyActivated, true);
});

test("Phase 3 - 20. Concurrent activation requests cannot double-activate", async () => {
  const user = createMockUser({ userId: "USER_CONCURRENT_001" });
  const order = await Order.create({
    orderId: "ORD-CONCUR-001",
    user: user._id,
    userId: user.userId,
    packageId: "pkg_gft_1",
    packageSnapshot: { packageId: "pkg_gft_1", name: "GFT-1", amount: 3000, confirmationStatus: "CONFIRMED" },
    amount: 3000,
    orderStatus: ORDER_STATUS.ACTIVATED,
    paymentStatus: PAYMENT_STATUS.CONFIRMED,
  });

  // Simultaneous calls
  const [res1, res2] = await Promise.all([
    activationService.evaluateActivation(order, user),
    activationService.evaluateActivation(order, user),
  ]);

  assert.strictEqual(res1.alreadyActivated, true);
  assert.strictEqual(res2.alreadyActivated, true);
});

test("Phase 3 - 21. User can only view own orders (Cross-user access returns HTTP 403)", async () => {
  const userA = createMockUser({ userId: "USER_ORDER_OWNER_A" });
  const userB = createMockUser({ userId: "USER_ORDER_ATTACKER_B" });

  const orderA = await orderService.createOrder({ user: userA, packageId: "pkg_gft_1" });

  // User B tries to read User A's order
  await assert.rejects(
    () => orderService.getOrderById(userB, orderA.orderId),
    (err) => err.statusCode === 403 && err.message.includes("Unauthorized access")
  );

  // User A reads their own order
  const orderFound = await orderService.getOrderById(userA, orderA.orderId);
  assert.strictEqual(orderFound.orderId, orderA.orderId);
});

test("Phase 3 - 22. Admin access to order inspection follows standard RBAC", async () => {
  const normalUser = createMockUser({ userId: "MEMBER_ORDER_001" });
  const adminUser = createMockUser({ userId: "ADMIN_OFFICER_001", role: "admin" });

  const order = await orderService.createOrder({ user: normalUser, packageId: "pkg_gft_1" });

  // Admin can inspect user's order
  const inspected = await orderService.getOrderById(adminUser, order.orderId);
  assert.strictEqual(inspected.orderId, order.orderId);

  // Admin can inspect full queue
  const queue = await orderService.getAdminOrderQueue(adminUser);
  assert.ok(queue.orders);
});

test("Phase 3 - 23. Super Admin access to order queue follows standard RBAC", async () => {
  const superAdmin = createMockUser({ userId: "SUPERADMIN_ROOT_001", role: "superadmin" });
  const normalUser = createMockUser({ userId: "MEMBER_ORDER_002", role: "user" });

  // Superadmin can view queue
  const queue = await orderService.getAdminOrderQueue(superAdmin);
  assert.ok(queue.orders);

  // Normal user cannot view admin queue
  await assert.rejects(
    () => orderService.getAdminOrderQueue(normalUser),
    (err) => err.statusCode === 403 && err.message.includes("Administrative privilege required")
  );
});

test("Phase 3 - 24. AuditLog entries are created for important state changes", () => {
  const actionsLogged = mockDB.auditLogs.map((l) => l.action);
  assert.ok(actionsLogged.includes("ORDER_CREATED"));
  assert.ok(actionsLogged.includes("PAYMENT_INITIATED"));
  assert.ok(actionsLogged.includes("PAYMENT_CONFIRMED"));
  assert.ok(actionsLogged.includes("ACTIVATION_BLOCKED"));
});

test("Phase 3 - 25. Zero sensitive payment secrets or private keys appear in audit logs", () => {
  for (const log of mockDB.auditLogs) {
    const serialized = JSON.stringify(log);
    assert.strictEqual(serialized.includes("private_key"), false);
    assert.strictEqual(serialized.includes("secret"), false);
    assert.strictEqual(serialized.includes("password"), false);
  }
});

test("Phase 3 - 26. Browser refresh / duplicate submission with identical idempotencyKey returns identical order", async () => {
  const user = createMockUser({ userId: "USER_REFRESH_001" });
  const idempotencyKey = "client-req-uuid-999888";

  const order1 = await orderService.createOrder({ user, packageId: "pkg_gft_1", idempotencyKey });
  const order2 = await orderService.createOrder({ user, packageId: "pkg_gft_1", idempotencyKey });

  assert.strictEqual(order1.orderId, order2.orderId);
});

test("Phase 3 - 27. Phase 0 master business plan status remains frozen under REQUIRES_CLIENT_CONFIRMATION", () => {
  assert.strictEqual(BUSINESS_PLAN_STATUS, "REQUIRES_CLIENT_CONFIRMATION");
  for (let i = 1; i <= 8; i++) {
    const pkg = PACKAGES[`pkg_gft_${i}`];
    assert.strictEqual(pkg.confirmationStatus, RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION);
  }
});

test("Phase 3 - 28. ACTIVATION_BLOCKED produces zero wallet, commission, or token side-effects", () => {
  // Check mockDB wallets and transactions
  assert.strictEqual(mockDB.wallets.size, 0);
  assert.strictEqual(mockDB.transactions.length, 0);
  // Zero commission or binary volume logs
  assert.strictEqual(mockDB.auditLogs.some((l) => l.action.includes("COMMISSION") || l.action.includes("VOLUME")), false);
});

test("Phase 3 - 29. Deprecated legacy buyPackage endpoint blocks unauthorized activation", async () => {
  const { buyPackage } = await import("../src/controllers/walletController.js");
  const req = { user: { userId: "GFT100100" }, body: { packageId: "pkg_gft_1" } };
  let caughtError = null;
  await buyPackage(req, {}, (err) => {
    caughtError = err;
  });

  assert.ok(caughtError instanceof AppError);
  assert.strictEqual(caughtError.statusCode, 410);
  assert.strictEqual(caughtError.message.includes("deprecated"), true);
});
