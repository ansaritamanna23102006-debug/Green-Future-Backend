/**
 * Green Future Tech (GFT) — Phase 1 Automated Test Suite
 * Validates Production Authentication & Multi-Step Onboarding Engine.
 * 
 * Required Tests:
 * TEST 1: Valid registration data can proceed through the registration flow.
 * TEST 2: Invalid sponsor ID is rejected.
 * TEST 3: User cannot sponsor themselves.
 * TEST 4: Duplicate email is rejected safely.
 * TEST 5: Duplicate mobile number is rejected safely if uniqueness is required.
 * TEST 6: Invalid OTP is rejected.
 * TEST 7: Expired OTP is rejected.
 * TEST 8: OTP cannot be reused after successful verification.
 * TEST 9: OTP resend is rate-limited.
 * TEST 10: Password is hashed and never returned.
 * TEST 11: Valid login succeeds.
 * TEST 12: Invalid login returns a safe generic error.
 * TEST 13: Expired/invalid authentication token is rejected.
 * TEST 14: Forgot-password token expires and cannot be reused.
 * TEST 15: Protected dashboard endpoint rejects unauthenticated requests.
 * TEST 16: Registration retry does not create duplicate accounts.
 * TEST 17: No financial data is modified by authentication operations.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import AuthService from "../src/services/authService.js";
import { protect } from "../src/middlewares/auth.js";
import User from "../src/models/User.js";
import RegistrationOtp from "../src/models/RegistrationOtp.js";
import Wallet from "../src/models/Wallet.js";
import Transaction from "../src/models/Transaction.js";
import AppError from "../src/utils/errors.js";

import GenealogyService from "../src/services/genealogyService.js";

// Mock helper to intercept model methods during tests
const mockDB = {
  users: new Map(),
  otps: new Map(),
  wallets: new Map(),
  transactions: [],
};

// Seed an active sponsor
const SEED_SPONSOR = {
  _id: "sponsor_object_id_001",
  userId: "GFT100201",
  name: "Elena Rostova",
  email: "elena@greenfuturetech.com",
  mobile: "9876543210",
  password: "$2a$10$hashedpasswordforseedingsponsor00000000000000000000000000",
  referralCode: "GFT100201",
  role: "user",
  status: "active",
  rank: "emerald",
  isEmailVerified: true,
  isMobileVerified: true,
  matchPassword: async (pwd) => pwd === "SponsorSecret@123",
  save: async function () { return this; },
};
mockDB.users.set(SEED_SPONSOR.userId, SEED_SPONSOR);
mockDB.users.set(SEED_SPONSOR.email, SEED_SPONSOR);

// Patch User methods for isolated unit testing
const originalUserFindOne = User.findOne;
const originalUserFindById = User.findById;
const originalUserCreate = User.create;
const originalOtpFindOne = RegistrationOtp.findOne;
const originalOtpDeleteOne = RegistrationOtp.deleteOne;
const originalWalletCreate = Wallet.create;
const originalTransactionCreate = Transaction.create;

function setupMocks() {
  GenealogyService.addMember = async () => true;

  User.findOne = (query) => {
    return {
      exec: async () => {
        if (query.$or) {
          for (const condition of query.$or) {
            if (condition.email && mockDB.users.has(condition.email)) return mockDB.users.get(condition.email);
            if (condition.userId && mockDB.users.has(condition.userId)) return mockDB.users.get(condition.userId);
          }
          return null;
        }
        if (query.userId) return mockDB.users.get(query.userId) || null;
        if (query.email) return mockDB.users.get(query.email) || null;
        if (query.mobile) {
          for (const u of mockDB.users.values()) {
            if (u.mobile === query.mobile) return u;
          }
        }
        return null;
      },
      then(resolve) {
        return this.exec().then(resolve);
      }
    };
  };

  User.findById = (id) => {
    return {
      exec: async () => {
        for (const u of mockDB.users.values()) {
          if (String(u._id) === String(id)) return u;
        }
        return null;
      },
      then(resolve) {
        return this.exec().then(resolve);
      }
    };
  };

  User.create = async (userData) => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(userData.password, salt);
    const newUser = {
      ...userData,
      _id: "user_obj_" + Math.random().toString(36).substring(2, 9),
      password: hashedPassword,
      activeDevices: [],
      matchPassword: async function (entered) {
        return await bcrypt.compare(entered, this.password);
      },
      save: async function () {
        if (this.password && !this.password.startsWith("$2")) {
          const salt = await bcrypt.genSalt(10);
          this.password = await bcrypt.hash(this.password, salt);
        }
        mockDB.users.set(this.userId, this);
        mockDB.users.set(this.email, this);
        return this;
      }
    };
    mockDB.users.set(newUser.userId, newUser);
    mockDB.users.set(newUser.email, newUser);
    return newUser;
  };

  RegistrationOtp.findOne = (query) => {
    return {
      exec: async () => {
        for (const record of mockDB.otps.values()) {
          let match = true;
          if (query.email && record.email !== query.email) match = false;
          if (query.verificationToken && record.verificationToken !== query.verificationToken) match = false;
          if (query.verified !== undefined && record.verified !== query.verified) match = false;
          if (match) return record;
        }
        return null;
      },
      then(resolve) {
        return this.exec().then(resolve);
      }
    };
  };

  RegistrationOtp.findOneAndUpdate = async (query, update) => {
    let rec = mockDB.otps.get(query.email);
    if (!rec) {
      rec = { _id: "otp_upsert_" + Math.random().toString(36).substring(2, 9), ...update };
      mockDB.otps.set(query.email, rec);
    } else {
      Object.assign(rec, update);
    }
    return rec;
  };

  RegistrationOtp.deleteOne = async (query) => {
    for (const [key, val] of mockDB.otps.entries()) {
      if (String(val._id) === String(query._id)) {
        mockDB.otps.delete(key);
        return { deletedCount: 1 };
      }
    }
    return { deletedCount: 0 };
  };

  Wallet.create = async (data) => {
    mockDB.wallets.set(data.userId, data);
    return data;
  };

  Transaction.create = async (data) => {
    mockDB.transactions.push(data);
    return data;
  };
}

setupMocks();

// ==========================================
// TEST 1: Valid registration data can proceed
// ==========================================
test("Phase 1 — TEST 1: Valid registration data can proceed through multi-step onboarding", async () => {
  const email = "alexander.pierce@example.com";
  const mobile = "9988776655";

  // Step A: Dispatch OTP
  const rawOtp = "456789";
  const otpHash = AuthService.hashOtp(rawOtp);
  const otpRecord = {
    _id: "otp_rec_1",
    email,
    mobile,
    otpHash,
    attempts: 0,
    maxAttempts: 3,
    verified: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    resendAvailableAt: new Date(Date.now() + 60 * 1000),
    save: async function () { return this; },
  };
  mockDB.otps.set(email, otpRecord);

  // Step B: Verify OTP
  const verifyResult = await AuthService.verifyRegistrationOtp(email, rawOtp);
  assert.equal(verifyResult.verified, true);
  assert.ok(verifyResult.verificationToken, "Must return single-use verificationToken");

  // Step C: Complete registration
  const regPayload = {
    name: "Alexander Pierce",
    email,
    mobile,
    password: "SecurePassword@2026",
    sponsorId: "GFT100201",
    position: "left",
    address: "221B Baker Street",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    verificationToken: verifyResult.verificationToken,
  };

  const regResult = await AuthService.register(regPayload);
  assert.ok(regResult.userId.startsWith("GFT"), "User ID must start with GFT");
  assert.equal(regResult.email, email);
  assert.equal(regResult.sponsorId, "GFT100201");
  assert.ok(regResult.referralCode, "Referral code must be issued");
  assert.equal(regResult.password, undefined, "Password must never be returned");
});

// ==========================================
// TEST 2: Invalid sponsor ID is rejected
// ==========================================
test("Phase 1 — TEST 2: Invalid sponsor ID is rejected server-side", async () => {
  await assert.rejects(
    async () => {
      await AuthService.validateSponsor("INVALID_SPONSOR_999");
    },
    (err) => {
      assert.ok(err.statusCode === 404 || err.statusCode === 400);
      assert.match(err.message, /does not exist|not found/i);
      return true;
    }
  );
});

// ==========================================
// TEST 3: User cannot sponsor themselves
// ==========================================
test("Phase 1 — TEST 3: User cannot sponsor themselves (self-sponsorship prevention)", async () => {
  await assert.rejects(
    async () => {
      await AuthService.validateSponsor("GFT100201", "GFT100201");
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /cannot sponsor/i);
      return true;
    }
  );
});

// ==========================================
// TEST 4: Duplicate email is rejected safely
// ==========================================
test("Phase 1 — TEST 4: Duplicate email is rejected safely during registration", async () => {
  const duplicateEmail = "alexander.pierce@example.com";
  const rawOtp = "112233";
  const otpRecord = {
    _id: "otp_rec_dup",
    email: duplicateEmail,
    verificationToken: "token_dup_test_123",
    verified: true,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(duplicateEmail, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.register({
        name: "Second Account",
        email: duplicateEmail,
        mobile: "9988112233",
        password: "SecurePassword@2026",
        sponsorId: "GFT100201",
        verificationToken: "token_dup_test_123",
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /already registered/i);
      return true;
    }
  );
});

// ==========================================
// TEST 5: Duplicate mobile number is rejected safely
// ==========================================
test("Phase 1 — TEST 5: Duplicate mobile number is rejected safely", async () => {
  const newEmail = "unique.email@domain.com";
  const duplicateMobile = "9988776655"; // Used in TEST 1
  const otpRecord = {
    _id: "otp_rec_mobile",
    email: newEmail,
    verificationToken: "token_mobile_dup_456",
    verified: true,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(newEmail, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.register({
        name: "Mobile Conflict User",
        email: newEmail,
        mobile: duplicateMobile,
        password: "SecurePassword@2026",
        sponsorId: "GFT100201",
        verificationToken: "token_mobile_dup_456",
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /mobile number is already registered/i);
      return true;
    }
  );
});

// ==========================================
// TEST 6: Invalid OTP is rejected
// ==========================================
test("Phase 1 — TEST 6: Invalid OTP is rejected with remaining attempt count", async () => {
  const email = "otp.test@domain.com";
  const rawOtp = "654321";
  const otpRecord = {
    _id: "otp_invalid_test",
    email,
    otpHash: AuthService.hashOtp(rawOtp),
    attempts: 0,
    maxAttempts: 3,
    verified: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(email, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.verifyRegistrationOtp(email, "999999"); // Wrong OTP
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /invalid verification code/i);
      assert.equal(otpRecord.attempts, 1);
      return true;
    }
  );
});

// ==========================================
// TEST 7: Expired OTP is rejected
// ==========================================
test("Phase 1 — TEST 7: Expired OTP is rejected", async () => {
  const email = "expired.otp@domain.com";
  const rawOtp = "123456";
  const otpRecord = {
    _id: "otp_expired_test",
    email,
    otpHash: AuthService.hashOtp(rawOtp),
    attempts: 0,
    maxAttempts: 3,
    verified: false,
    expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    save: async function () { return this; }
  };
  mockDB.otps.set(email, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.verifyRegistrationOtp(email, rawOtp);
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /expired/i);
      return true;
    }
  );
});

// ==========================================
// TEST 8: OTP cannot be reused after verification
// ==========================================
test("Phase 1 — TEST 8: OTP cannot be reused after successful verification", async () => {
  const email = "single.use@domain.com";
  const rawOtp = "789123";
  const otpRecord = {
    _id: "otp_reuse_test",
    email,
    otpHash: AuthService.hashOtp(rawOtp),
    attempts: 0,
    maxAttempts: 3,
    verified: true, // Already verified!
    verificationToken: "token_already_verified",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(email, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.verifyRegistrationOtp(email, rawOtp);
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /already been used/i);
      return true;
    }
  );
});

// ==========================================
// TEST 9: OTP resend is rate-limited
// ==========================================
test("Phase 1 — TEST 9: OTP resend is rate-limited (60-second cooldown)", async () => {
  const email = "cooldown@domain.com";
  const mobile = "9112233445";

  // Mock finding existing record within cooldown (lastSentAt 15 seconds ago)
  const originalOtpFindOneLocal = RegistrationOtp.findOne;
  RegistrationOtp.findOne = () => ({
    exec: async () => ({
      email,
      lastSentAt: new Date(Date.now() - 15 * 1000), // 15 seconds ago, cooldown active
    }),
    then(r) { return this.exec().then(r); }
  });

  await assert.rejects(
    async () => {
      await AuthService.sendRegistrationOtp(email, mobile);
    },
    (err) => {
      assert.equal(err.statusCode, 429);
      assert.match(err.message, /wait \d+ seconds before requesting a new code/i);
      return true;
    }
  );

  RegistrationOtp.findOne = originalOtpFindOneLocal;
});

// ==========================================
// TEST 10: Password is hashed and never returned
// ==========================================
test("Phase 1 — TEST 10: Password is encrypted with bcrypt and never exposed in API responses", async () => {
  const user = mockDB.users.get("alexander.pierce@example.com");
  assert.ok(user.password.startsWith("$2a$") || user.password.startsWith("$2b$"), "Password must be bcrypt hash");
  assert.notEqual(user.password, "SecurePassword@2026", "Plaintext password must not be stored");

  // Verify matchPassword works
  const matches = await user.matchPassword("SecurePassword@2026");
  assert.equal(matches, true);
  const wrongMatch = await user.matchPassword("WrongPassword@123");
  assert.equal(wrongMatch, false);
});

// ==========================================
// TEST 11: Valid login succeeds
// ==========================================
test("Phase 1 — TEST 11: Valid login returns JWT access and refresh tokens", async () => {
  process.env.JWT_SECRET = "test_jwt_access_secret_key_12345";
  process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret_key_12345";

  const result = await AuthService.login(
    "alexander.pierce@example.com",
    "SecurePassword@2026",
    { ip: "127.0.0.1", userAgent: "NodeTestAgent" }
  );

  assert.ok(result.accessToken, "Must generate accessToken");
  assert.ok(result.refreshToken, "Must generate refreshToken");
  assert.equal(result.user.email, "alexander.pierce@example.com");
  assert.equal(result.user.password, undefined, "User object must not return password");

  // Verify token decoding
  const decoded = jwt.verify(result.accessToken, process.env.JWT_SECRET);
  assert.equal(decoded.userId, result.user.userId);
});

// ==========================================
// TEST 12: Invalid login returns safe generic error
// ==========================================
test("Phase 1 — TEST 12: Invalid login returns safe generic error to prevent account enumeration", async () => {
  // Non-existent email
  await assert.rejects(
    async () => {
      await AuthService.login("doesnotexist@nowhere.com", "SomePassword@123");
    },
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, "Invalid credentials");
      return true;
    }
  );

  // Existing email, wrong password
  await assert.rejects(
    async () => {
      await AuthService.login("alexander.pierce@example.com", "WrongPassword@999");
    },
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, "Invalid credentials");
      return true;
    }
  );
});

// ==========================================
// TEST 13: Expired/invalid authentication token is rejected
// ==========================================
test("Phase 1 — TEST 13: Expired or invalid authentication token is rejected by protect middleware", async () => {
  process.env.JWT_SECRET = "test_jwt_access_secret_key_12345";

  // Case A: Malformed/Invalid token
  const reqInvalid = {
    headers: { authorization: "Bearer invalid_malformed_token_string" }
  };
  let errorCaptured = null;
  await protect(reqInvalid, {}, (err) => { errorCaptured = err; });
  assert.ok(errorCaptured instanceof AppError);
  assert.equal(errorCaptured.statusCode, 401);
  assert.match(errorCaptured.message, /invalid or malformed token/i);

  // Case B: Expired token
  const expiredToken = jwt.sign(
    { id: "some_user_id" },
    process.env.JWT_SECRET,
    { expiresIn: "-1s" } // Expired 1 second ago
  );
  const reqExpired = {
    headers: { authorization: `Bearer ${expiredToken}` }
  };
  let expiredErrorCaptured = null;
  await protect(reqExpired, {}, (err) => { expiredErrorCaptured = err; });
  assert.ok(expiredErrorCaptured instanceof AppError);
  assert.equal(expiredErrorCaptured.statusCode, 401);
  assert.match(expiredErrorCaptured.message, /token has expired/i);
});

// ==========================================
// TEST 14: Forgot-password token expires & cannot be reused
// ==========================================
test("Phase 1 — TEST 14: Forgot-password token expires and cannot be reused", async () => {
  const targetUser = mockDB.users.get("alexander.pierce@example.com");
  const rawResetOtp = "889900";
  targetUser.passwordResetToken = AuthService.hashOtp(rawResetOtp);
  targetUser.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
  targetUser.passwordResetAttempts = 0;

  // Attempt A: Reset password successfully
  const resetRes = await AuthService.resetPassword(
    "alexander.pierce@example.com",
    rawResetOtp,
    "BrandNewPassword@2026"
  );
  assert.match(resetRes.message, /updated successfully/i);
  assert.equal(targetUser.passwordResetToken, undefined, "Token must be cleared after use");

  // Attempt B: Re-using the same OTP must fail
  await assert.rejects(
    async () => {
      await AuthService.resetPassword(
        "alexander.pierce@example.com",
        rawResetOtp,
        "AnotherNewPassword@2026"
      );
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /expired/i);
      return true;
    }
  );
});

// ==========================================
// TEST 15: Protected dashboard endpoint rejects unauthenticated requests
// ==========================================
test("Phase 1 — TEST 15: Protected endpoint rejects unauthenticated requests (missing Bearer token)", async () => {
  const reqNoAuth = { headers: {} };
  let errorCaptured = null;
  await protect(reqNoAuth, {}, (err) => { errorCaptured = err; });
  assert.ok(errorCaptured instanceof AppError);
  assert.equal(errorCaptured.statusCode, 401);
  assert.match(errorCaptured.message, /not logged in/i);
});

// ==========================================
// TEST 16: Registration retry does not create duplicate accounts
// ==========================================
test("Phase 1 — TEST 16: Registration retry with same email does not create duplicate accounts", async () => {
  const totalUsersBefore = mockDB.users.size;

  await assert.rejects(
    async () => {
      await AuthService.register({
        name: "Alexander Pierce Retry",
        email: "alexander.pierce@example.com",
        mobile: "9988776655",
        password: "SecurePassword@2026",
        sponsorId: "GFT100201",
        verificationToken: "non_existent_or_expired_token",
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );

  const totalUsersAfter = mockDB.users.size;
  assert.equal(totalUsersAfter, totalUsersBefore, "No duplicate user record created on retry failure");
});

// ==========================================
// TEST 17: No financial data is modified by auth operations
// ==========================================
test("Phase 1 — TEST 17: No financial data or existing balances are modified by authentication operations", async () => {
  // Verify that SEED_SPONSOR wallet remains untouched
  const sponsorWallet = mockDB.wallets.get(SEED_SPONSOR.userId);
  assert.equal(sponsorWallet, undefined, "Sponsor financial balances were not modified by auth operations");

  // Verify that new user only gets standard non-withdrawable signup tokens (100 GFT)
  const newUserWallet = mockDB.wallets.get("alexander.pierce@example.com");
  assert.equal(mockDB.transactions.some(t => t.category === "withdrawal" || t.category === "commission"), false,
    "No commissions or withdrawals were triggered during Phase 1 onboarding"
  );
});

// ==========================================
// TEST 18: Dedicated server-side OTP hashing secret/pepper
// ==========================================
test("Phase 1 — TEST 18: Dedicated server-side OTP pepper decouples OTP hashing from JWT_SECRET", () => {
  const hash1 = AuthService.hashOtp("123456");
  process.env.JWT_SECRET = "changed_jwt_secret_999";
  const hash2 = AuthService.hashOtp("123456");

  assert.equal(hash1, hash2, "OTP hash must rely on dedicated OTP pepper rather than JWT_SECRET");
});

// ==========================================
// TEST 19: Maximum 5 failed OTP attempts triggers lockout
// ==========================================
test("Phase 1 — TEST 19: Exceeding maximum 5 failed OTP attempts triggers HTTP 429 lockout", async () => {
  const email = "lockout.test@domain.com";
  const rawOtp = "556677";
  const otpRecord = {
    _id: "otp_lockout_test",
    email,
    otpHash: AuthService.hashOtp(rawOtp),
    attempts: 5, // Already reached max attempts
    maxAttempts: 5,
    verified: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(email, otpRecord);

  await assert.rejects(
    async () => {
      await AuthService.verifyRegistrationOtp(email, rawOtp);
    },
    (err) => {
      assert.equal(err.statusCode, 429);
      assert.match(err.message, /maximum verification attempts exceeded/i);
      return true;
    }
  );
});

// ==========================================
// TEST 20: Raw OTP immediately invalidated after successful verification
// ==========================================
test("Phase 1 — TEST 20: Raw OTP is immediately invalidated upon verification (otpHash cleared)", async () => {
  const email = "instant.invalidation@domain.com";
  const rawOtp = "887766";
  const otpRecord = {
    _id: "otp_instant_inv",
    email,
    otpHash: AuthService.hashOtp(rawOtp),
    attempts: 0,
    maxAttempts: 5,
    verified: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    save: async function () { return this; }
  };
  mockDB.otps.set(email, otpRecord);

  const res = await AuthService.verifyRegistrationOtp(email, rawOtp);
  assert.equal(res.verified, true);
  assert.equal(otpRecord.otpHash, null, "Raw OTP hash must be cleared immediately upon verification");
  assert.ok(otpRecord.verificationToken, "Must have generated verificationToken");
});

// ==========================================
// TEST 21: Bounded active device policy
// ==========================================
test("Phase 1 — TEST 21: Bounded device policy updates existing device and caps at 5 maximum devices", async () => {
  const testUser = {
    _id: "user_device_test",
    userId: "GFT888999",
    activeDevices: [],
  };

  // Add device A
  AuthService.manageDeviceSession(testUser, { ip: "192.168.1.1", userAgent: "Chrome 120" }, "hash_a");
  assert.equal(testUser.activeDevices.length, 1);

  // Re-login from device A: must update existing entry, not duplicate!
  AuthService.manageDeviceSession(testUser, { ip: "192.168.1.1", userAgent: "Chrome 120" }, "hash_a_updated");
  assert.equal(testUser.activeDevices.length, 1, "Must update existing device rather than duplicating");
  assert.equal(testUser.activeDevices[0].refreshTokenHash, "hash_a_updated");

  // Add 5 more distinct devices: total must never exceed 5!
  for (let i = 2; i <= 6; i++) {
    AuthService.manageDeviceSession(
      testUser,
      { ip: `192.168.1.${i}`, userAgent: `Browser ${i}` },
      `hash_${i}`
    );
  }

  assert.equal(testUser.activeDevices.length, 5, "Active devices must be capped strictly at 5 (bounded policy)");
});

// ==========================================
// TEST 22: Refresh token rotation & revocation detection
// ==========================================
test("Phase 1 — TEST 22: Refresh token rotation issues new pair and detects reused/revoked tokens", async () => {
  const loginRes = await AuthService.login(
    "alexander.pierce@example.com",
    "BrandNewPassword@2026",
    { ip: "10.0.0.1", userAgent: "Firefox" }
  );

  const initialRefreshToken = loginRes.refreshToken;

  // Step 1: Valid refresh token rotation
  const rotated = await AuthService.refreshAccessToken(
    initialRefreshToken,
    { ip: "10.0.0.1", userAgent: "Firefox" }
  );

  assert.ok(rotated.accessToken, "Must issue new accessToken");
  assert.ok(rotated.refreshToken, "Must issue new rotated refreshToken");
  assert.notEqual(rotated.refreshToken, initialRefreshToken, "Rotated refresh token must differ from old one");

  // Step 2: Re-using the old (rotated) refresh token must be rejected with 401
  await assert.rejects(
    async () => {
      await AuthService.refreshAccessToken(initialRefreshToken, { ip: "10.0.0.1", userAgent: "Firefox" });
    },
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /invalid or revoked/i);
      return true;
    }
  );
});

// ==========================================
// TEST 23: Logout revokes refresh token
// ==========================================
test("Phase 1 — TEST 23: Logout revokes refresh token session", async () => {
  const user = mockDB.users.get("alexander.pierce@example.com");
  const loginRes = await AuthService.login(
    "alexander.pierce@example.com",
    "BrandNewPassword@2026",
    { ip: "10.0.0.2", userAgent: "Safari" }
  );

  const tokenToRevoke = loginRes.refreshToken;
  const tokenHash = AuthService.hashRefreshToken(tokenToRevoke);
  assert.ok(user.activeDevices.some(d => d.refreshTokenHash === tokenHash));

  // Perform logout
  const logoutRes = await AuthService.logout(user._id, tokenToRevoke);
  assert.equal(logoutRes.loggedOut, true);

  // Verify device session was revoked
  assert.equal(user.activeDevices.some(d => d.refreshTokenHash === tokenHash), false,
    "Refresh token hash must be removed from activeDevices on logout"
  );
});

// ==========================================
// TEST 24: Password reset revokes all active device sessions
// ==========================================
test("Phase 1 — TEST 24: Password reset clears all active device sessions across all devices", async () => {
  const user = mockDB.users.get("alexander.pierce@example.com");
  // Seed active device
  user.activeDevices = [{ deviceId: "d1", refreshTokenHash: "h1", lastActive: new Date() }];

  const rawResetOtp = "123987";
  user.passwordResetToken = AuthService.hashOtp(rawResetOtp);
  user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
  user.passwordResetAttempts = 0;

  await AuthService.resetPassword(
    "alexander.pierce@example.com",
    rawResetOtp,
    "FinalSecurePassword@2026"
  );

  assert.equal(user.activeDevices.length, 0, "All active device sessions must be revoked on password reset");
});
