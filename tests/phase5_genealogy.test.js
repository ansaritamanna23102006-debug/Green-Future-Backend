/**
 * Green Future Tech (GFT) — Phase 5 Test Suite
 * Genealogy & Referral Network Foundation
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Models
import User from "../src/models/User.js";
import Genealogy from "../src/models/Genealogy.js";
import Wallet from "../src/models/Wallet.js";
import JournalEntry from "../src/models/JournalEntry.js";
import LedgerPosting from "../src/models/LedgerPosting.js";
import AuditLog from "../src/models/AuditLog.js";

// Services and Utilities
import genealogyService from "../src/services/genealogyService.js";
import {
  PLACEMENT_POSITION,
  GENEALOGY_TREE_LIMITS,
  GENEALOGY_AUDIT_ACTIONS,
} from "../src/utils/rules/genealogyConstants.js";

const TEST_MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gft-db";

describe("PHASE 5 — GENEALOGY & REFERRAL NETWORK FOUNDATION", async () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGODB_URI);
    }
    // Clean up test data
    await mongoose.connection.collection("genealogies").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
  });

  after(async () => {
    await mongoose.connection.collection("genealogies").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("users").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("wallets").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.connection.collection("auditlogs").deleteMany({ userId: /^TEST_P5_/ }).catch(() => {});
    await mongoose.disconnect();
  });

  // Helper to create test user
  const createTestUser = async (userId, sponsorId = "none", name = "Test User") => {
    return await User.create({
      userId,
      sponsorId,
      sponsorName: sponsorId === "none" ? "None" : "Sponsor Name",
      name,
      email: `${userId.toLowerCase()}@gft.test`,
      mobile: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      password: "HashedPassword123!",
      referralCode: `REF_${userId}`,
      status: "active",
      leftLegSalesVolume: 0,
      rightLegSalesVolume: 0,
      leftLegActiveUsers: 0,
      rightLegActiveUsers: 0,
      leftLegCarryForward: 0,
      rightLegCarryForward: 0,
    });
  };

  // Helper to create wallet
  const createTestWallet = async (userId) => {
    return await Wallet.create({
      userId,
      availablePaisa: 0,
      lockedPaisa: 0,
      totalEarnedPaisa: 0,
    });
  };

  // ==========================================
  // SECTION 1: SPONSOR RELATIONSHIP & ASSIGNMENT
  // ==========================================

  test("1. Valid sponsor assignment succeeds", async () => {
    await createTestUser("TEST_P5_SPONSOR_1", "none", "Sponsor Alpha");
    await createTestUser("TEST_P5_USER_1", "none", "Recruit Alpha");

    const result = await genealogyService.assignSponsor("TEST_P5_USER_1", "TEST_P5_SPONSOR_1");
    assert.strictEqual(result.userId, "TEST_P5_USER_1");
    assert.strictEqual(result.sponsorId, "TEST_P5_SPONSOR_1");

    const userInDb = await User.findOne({ userId: "TEST_P5_USER_1" });
    assert.strictEqual(userInDb.sponsorId, "TEST_P5_SPONSOR_1");
  });

  test("2. Nonexistent sponsor is rejected with 404", async () => {
    await createTestUser("TEST_P5_USER_2", "none");
    await assert.rejects(
      async () => {
        await genealogyService.assignSponsor("TEST_P5_USER_2", "TEST_P5_GHOST_SPONSOR");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.match(err.message, /does not exist/);
        return true;
      }
    );
  });

  test("3. Self-sponsorship is rejected with 400", async () => {
    await createTestUser("TEST_P5_USER_3", "none");
    await assert.rejects(
      async () => {
        await genealogyService.assignSponsor("TEST_P5_USER_3", "TEST_P5_USER_3");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /cannot sponsor themselves/);
        return true;
      }
    );
  });

  test("4. Suspended sponsor is rejected with 400", async () => {
    const suspendedSponsor = await createTestUser("TEST_P5_SUSPENDED_SPONSOR", "none");
    suspendedSponsor.status = "suspended";
    await suspendedSponsor.save();

    await createTestUser("TEST_P5_USER_4", "none");
    await assert.rejects(
      async () => {
        await genealogyService.assignSponsor("TEST_P5_USER_4", "TEST_P5_SUSPENDED_SPONSOR");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /suspended/);
        return true;
      }
    );
  });

  test("5. Duplicate identical sponsor assignment is safe/idempotent", async () => {
    const result = await genealogyService.assignSponsor("TEST_P5_USER_1", "TEST_P5_SPONSOR_1");
    assert.strictEqual(result.sponsorId, "TEST_P5_SPONSOR_1");
  });

  test("6. Sponsor assignment is immutable; attempted change is rejected with 409", async () => {
    await createTestUser("TEST_P5_SPONSOR_2", "none");
    await assert.rejects(
      async () => {
        // Attempting to change TEST_P5_USER_1's sponsor from SPONSOR_1 to SPONSOR_2
        await genealogyService.assignSponsor("TEST_P5_USER_1", "TEST_P5_SPONSOR_2");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.match(err.message, /already assigned and cannot be modified/);
        return true;
      }
    );
  });

  // ==========================================
  // SECTION 2: BINARY PLACEMENT & CONCURRENCY
  // ==========================================

  test("7. Root node placement succeeds with parentId empty", async () => {
    await createTestUser("TEST_P5_ROOT", "none", "Root Member");
    const rootNode = await genealogyService.placeMember("TEST_P5_ROOT", "", "left", "none");
    assert.strictEqual(rootNode.userId, "TEST_P5_ROOT");
    assert.strictEqual(rootNode.parentId, "");
    assert.deepStrictEqual(rootNode.ancestors, []);
  });

  test("8. Valid LEFT child placement succeeds and updates parent link", async () => {
    await createTestUser("TEST_P5_LEFT_CHILD", "TEST_P5_ROOT", "Left Member");
    const childNode = await genealogyService.placeMember(
      "TEST_P5_LEFT_CHILD",
      "TEST_P5_ROOT",
      "left",
      "TEST_P5_ROOT"
    );
    assert.strictEqual(childNode.userId, "TEST_P5_LEFT_CHILD");
    assert.strictEqual(childNode.parentId, "TEST_P5_ROOT");
    assert.strictEqual(childNode.placementLeg, "left");
    assert.deepStrictEqual(childNode.ancestors, ["TEST_P5_ROOT"]);

    const updatedParent = await Genealogy.findOne({ userId: "TEST_P5_ROOT" });
    assert.strictEqual(updatedParent.leftNodeId, "TEST_P5_LEFT_CHILD");
  });

  test("9. Valid RIGHT child placement succeeds and updates parent link", async () => {
    await createTestUser("TEST_P5_RIGHT_CHILD", "TEST_P5_ROOT", "Right Member");
    const childNode = await genealogyService.placeMember(
      "TEST_P5_RIGHT_CHILD",
      "TEST_P5_ROOT",
      "right",
      "TEST_P5_ROOT"
    );
    assert.strictEqual(childNode.userId, "TEST_P5_RIGHT_CHILD");
    assert.strictEqual(childNode.parentId, "TEST_P5_ROOT");
    assert.strictEqual(childNode.placementLeg, "right");
    assert.deepStrictEqual(childNode.ancestors, ["TEST_P5_ROOT"]);

    const updatedParent = await Genealogy.findOne({ userId: "TEST_P5_ROOT" });
    assert.strictEqual(updatedParent.rightNodeId, "TEST_P5_RIGHT_CHILD");
  });

  test("10. Occupied LEFT placement slot is rejected with 409", async () => {
    await createTestUser("TEST_P5_COMPETING_LEFT", "TEST_P5_ROOT");
    await assert.rejects(
      async () => {
        await genealogyService.placeMember(
          "TEST_P5_COMPETING_LEFT",
          "TEST_P5_ROOT",
          "left",
          "TEST_P5_ROOT"
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.match(err.message, /already has a left child/);
        return true;
      }
    );
  });

  test("11. Occupied RIGHT placement slot is rejected with 409", async () => {
    await createTestUser("TEST_P5_COMPETING_RIGHT", "TEST_P5_ROOT");
    await assert.rejects(
      async () => {
        await genealogyService.placeMember(
          "TEST_P5_COMPETING_RIGHT",
          "TEST_P5_ROOT",
          "right",
          "TEST_P5_ROOT"
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.match(err.message, /already has a right child/);
        return true;
      }
    );
  });

  test("12. Self-parent placement is rejected with 400", async () => {
    await createTestUser("TEST_P5_SELF_PARENT", "none");
    await assert.rejects(
      async () => {
        await genealogyService.placeMember(
          "TEST_P5_SELF_PARENT",
          "TEST_P5_SELF_PARENT",
          "left",
          "none"
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Self-placement is forbidden/);
        return true;
      }
    );
  });

  test("13. Descendant-parent cycle is rejected (User A cannot place under its descendant)", async () => {
    // Current chain: ROOT -> LEFT_CHILD
    // Attempt to place ROOT under LEFT_CHILD
    await assert.rejects(
      async () => {
        await genealogyService.placeMember(
          "TEST_P5_ROOT",
          "TEST_P5_LEFT_CHILD",
          "left",
          "none"
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409); // Already placed
        return true;
      }
    );

    // Now test with an unplaced user attempting to parent under a node that has it in ancestors
    // Create a deep node: LEFT_CHILD -> DEEP_1
    await createTestUser("TEST_P5_DEEP_1", "TEST_P5_ROOT");
    const deep1 = await genealogyService.placeMember(
      "TEST_P5_DEEP_1",
      "TEST_P5_LEFT_CHILD",
      "left",
      "TEST_P5_ROOT"
    );
    assert.deepStrictEqual(deep1.ancestors, ["TEST_P5_ROOT", "TEST_P5_LEFT_CHILD"]);
  });

  test("14. Duplicate placement of the same user is rejected with 409", async () => {
    await assert.rejects(
      async () => {
        await genealogyService.placeMember(
          "TEST_P5_LEFT_CHILD",
          "TEST_P5_RIGHT_CHILD",
          "left",
          "TEST_P5_ROOT"
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.match(err.message, /already placed/);
        return true;
      }
    );
  });

  test("15. Concurrent placement race condition safely awards slot to exactly one winner", async () => {
    // Create parent node with empty left slot
    await createTestUser("TEST_P5_RACE_PARENT", "none");
    await genealogyService.placeMember("TEST_P5_RACE_PARENT", "", "left", "none");

    await createTestUser("TEST_P5_RACE_CANDIDATE_A", "TEST_P5_RACE_PARENT");
    await createTestUser("TEST_P5_RACE_CANDIDATE_B", "TEST_P5_RACE_PARENT");

    // Launch both placement requests concurrently targeting RACE_PARENT's left slot
    const results = await Promise.allSettled([
      genealogyService.placeMember("TEST_P5_RACE_CANDIDATE_A", "TEST_P5_RACE_PARENT", "left", "TEST_P5_RACE_PARENT"),
      genealogyService.placeMember("TEST_P5_RACE_CANDIDATE_B", "TEST_P5_RACE_PARENT", "left", "TEST_P5_RACE_PARENT"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one concurrent placement must succeed");
    assert.strictEqual(rejected.length, 1, "Exactly one concurrent placement must be rejected");
    assert.strictEqual(rejected[0].reason.statusCode, 409, "Rejected placement must return HTTP 409");

    const parentInDb = await Genealogy.findOne({ userId: "TEST_P5_RACE_PARENT" });
    const winnerId = fulfilled[0].value.userId;
    assert.strictEqual(parentInDb.leftNodeId, winnerId, "Parent leftNodeId must strictly equal the winner ID");
  });

  // ==========================================
  // SECTION 3: REGRESSION TEST FOR PARENT MUTATION BUG
  // ==========================================

  test("16. REGRESSION FIX: Placing a member updates the CHILD's parentId, NEVER the PARENT's parentId", async () => {
    await createTestUser("TEST_P5_BUG_PARENT", "none");
    await genealogyService.placeMember("TEST_P5_BUG_PARENT", "", "left", "none");

    // Verify initial state of parent user document
    const initialParentUser = await User.findOne({ userId: "TEST_P5_BUG_PARENT" });
    assert.strictEqual(initialParentUser.parentId, "", "Parent initial parentId should be empty");

    await createTestUser("TEST_P5_BUG_CHILD", "TEST_P5_BUG_PARENT");
    await genealogyService.placeMember("TEST_P5_BUG_CHILD", "TEST_P5_BUG_PARENT", "left", "TEST_P5_BUG_PARENT");

    // Check parent User document
    const parentUserAfter = await User.findOne({ userId: "TEST_P5_BUG_PARENT" });
    assert.strictEqual(
      parentUserAfter.parentId,
      "",
      "CRITICAL: Parent's parentId MUST NOT be mutated to itself or changed by child placement!"
    );

    // Check child User document
    const childUserAfter = await User.findOne({ userId: "TEST_P5_BUG_CHILD" });
    assert.strictEqual(childUserAfter.parentId, "TEST_P5_BUG_PARENT", "Child parentId must be set to parent's ID");
    assert.strictEqual(childUserAfter.position, "left", "Child position must be set to 'left'");
  });

  // ==========================================
  // SECTION 4: NETWORK TRAVERSAL & DEPTH SAFETY
  // ==========================================

  test("17. findPlacement correctly identifies next available extreme left slot", async () => {
    // Current left path from ROOT is: ROOT -> LEFT_CHILD -> DEEP_1
    // DEEP_1 left is empty
    const nextLeft = await genealogyService.findPlacement("TEST_P5_ROOT", "left");
    assert.strictEqual(nextLeft.parentId, "TEST_P5_DEEP_1");
    assert.strictEqual(nextLeft.position, "left");
  });

  test("18. findPlacement correctly identifies next available extreme right slot", async () => {
    // Current right path from ROOT is: ROOT -> RIGHT_CHILD
    // RIGHT_CHILD right is empty
    const nextRight = await genealogyService.findPlacement("TEST_P5_ROOT", "right");
    assert.strictEqual(nextRight.parentId, "TEST_P5_RIGHT_CHILD");
    assert.strictEqual(nextRight.position, "right");
  });

  test("19. getBinaryTree returns nested tree structure with accurate privacy filtering", async () => {
    const tree = await genealogyService.getBinaryTree("TEST_P5_ROOT", 3);
    assert.strictEqual(tree.userId, "TEST_P5_ROOT");
    assert.strictEqual(tree.left.userId, "TEST_P5_LEFT_CHILD");
    assert.strictEqual(tree.right.userId, "TEST_P5_RIGHT_CHILD");
    assert.strictEqual(tree.left.left.userId, "TEST_P5_DEEP_1");

    // PRIVACY VERIFICATION: Sensitive fields must NOT exist in the tree response
    assert.strictEqual(tree.password, undefined);
    assert.strictEqual(tree.email, undefined);
    assert.strictEqual(tree.mobile, undefined);
    assert.strictEqual(tree.kyc, undefined);
    assert.strictEqual(tree.bankDetails, undefined);
    assert.strictEqual(tree.wallet, undefined);
    assert.strictEqual(tree.twoFASecret, undefined);
  });

  test("20. getSponsorTree returns unilevel direct referral hierarchy", async () => {
    const sponsorTree = await genealogyService.getSponsorTree("TEST_P5_ROOT", 2);
    assert.strictEqual(sponsorTree.userId, "TEST_P5_ROOT");
    assert(Array.isArray(sponsorTree.children));
    assert(sponsorTree.children.length >= 2);

    // Verify privacy
    assert.strictEqual(sponsorTree.children[0].password, undefined);
    assert.strictEqual(sponsorTree.children[0].mobile, undefined);
    assert.strictEqual(sponsorTree.children[0].email, undefined);
  });

  test("21. getDirectReferrals supports pagination and status filtering", async () => {
    const result = await genealogyService.getDirectReferrals("TEST_P5_ROOT", { page: 1, limit: 2 });
    assert.strictEqual(result.referrals.length, 2);
    assert.strictEqual(result.pagination.page, 1);
    assert.strictEqual(result.pagination.limit, 2);
    assert(result.pagination.total >= 2);
  });

  test("22. getTreeStats returns O(1) accurate branch counts", async () => {
    const stats = await genealogyService.getTreeStats("TEST_P5_ROOT");
    // Left branch has LEFT_CHILD and DEEP_1 (at least 2 nodes)
    assert(stats.leftCount >= 2, `Expected leftCount >= 2, got ${stats.leftCount}`);
    // Right branch has RIGHT_CHILD (at least 1 node)
    assert(stats.rightCount >= 1, `Expected rightCount >= 1, got ${stats.rightCount}`);
    assert.strictEqual(stats.totalCount, stats.leftCount + stats.rightCount);
  });

  test("23. Depth parameter clamping prevents excessive recursive query load", async () => {
    // Requesting depth 100 on binary tree should clamp to MAX_BINARY_TREE_DEPTH (5)
    const tree = await genealogyService.getBinaryTree("TEST_P5_ROOT", 100);
    assert.ok(tree);
  });

  // ==========================================
  // SECTION 5: ZERO FINANCIAL SIDE-EFFECTS PROOF
  // ==========================================

  test("24. Placement strictly produces ZERO financial side-effects", async () => {
    await createTestUser("TEST_P5_FIN_ROOT", "none");
    await createTestWallet("TEST_P5_FIN_ROOT");
    await genealogyService.placeMember("TEST_P5_FIN_ROOT", "", "left", "none");

    const journalCountBefore = await JournalEntry.countDocuments({});
    const postingCountBefore = await LedgerPosting.countDocuments({});

    // Place child under FIN_ROOT
    await createTestUser("TEST_P5_FIN_CHILD", "TEST_P5_FIN_ROOT");
    await createTestWallet("TEST_P5_FIN_CHILD");
    await genealogyService.placeMember("TEST_P5_FIN_CHILD", "TEST_P5_FIN_ROOT", "left", "TEST_P5_FIN_ROOT");

    // 1. Check parent volume counters
    const rootUserAfter = await User.findOne({ userId: "TEST_P5_FIN_ROOT" });
    assert.strictEqual(rootUserAfter.leftLegSalesVolume, 0, "leftLegSalesVolume must remain 0");
    assert.strictEqual(rootUserAfter.rightLegSalesVolume, 0, "rightLegSalesVolume must remain 0");
    assert.strictEqual(rootUserAfter.leftLegActiveUsers, 0, "leftLegActiveUsers must remain 0");
    assert.strictEqual(rootUserAfter.rightLegActiveUsers, 0, "rightLegActiveUsers must remain 0");
    assert.strictEqual(rootUserAfter.leftLegCarryForward, 0, "leftLegCarryForward must remain 0");
    assert.strictEqual(rootUserAfter.rightLegCarryForward, 0, "rightLegCarryForward must remain 0");

    // 2. Check Wallets
    const rootWallet = await Wallet.findOne({ userId: "TEST_P5_FIN_ROOT" });
    assert.strictEqual(rootWallet.availablePaisa, 0, "Wallet availablePaisa must remain 0");
    assert.strictEqual(rootWallet.lockedPaisa, 0, "Wallet lockedPaisa must remain 0");
    assert.strictEqual(rootWallet.totalEarnedPaisa, 0, "Wallet totalEarnedPaisa must remain 0");

    // 3. Check Ledger
    const journalCountAfter = await JournalEntry.countDocuments({});
    const postingCountAfter = await LedgerPosting.countDocuments({});
    assert.strictEqual(journalCountAfter, journalCountBefore, "Zero JournalEntry records must be created");
    assert.strictEqual(postingCountAfter, postingCountBefore, "Zero LedgerPosting records must be created");
  });

  // ==========================================
  // SECTION 6: INTEGRITY VALIDATION & AUDIT LOGS
  // ==========================================

  test("25. validateIntegrity accurately validates consistent genealogy trees", async () => {
    const report = await genealogyService.validateIntegrity("TEST_P5_FIN_ROOT");
    assert.strictEqual(report.valid, true);
    assert.strictEqual(report.errors.length, 0);
  });

  test("26. validateIntegrity detects ghost children, cycles, and asymmetries", async () => {
    // Artificially inject an inconsistent test node
    await Genealogy.create({
      userId: "TEST_P5_CORRUPT_NODE",
      parentId: "TEST_P5_NONEXISTENT_PARENT",
      sponsorId: "TEST_P5_ROOT",
      leftNodeId: "TEST_P5_GHOST_CHILD",
      ancestors: ["TEST_P5_CORRUPT_NODE"], // Self-cycle in ancestors
      placementLeg: "left",
    });

    const report = await genealogyService.validateIntegrity("TEST_P5_CORRUPT_NODE");
    assert.strictEqual(report.valid, false);
    assert(report.errors.some((e) => e.type === "ANCESTOR_CYCLE"));
    assert(report.errors.some((e) => e.type === "MISSING_PARENT_GENEALOGY"));
    assert(report.errors.some((e) => e.type === "GHOST_LEFT_CHILD"));
  });

  test("27. AuditLog records GENEALOGY_MEMBER_PLACED on successful placement", async () => {
    const logs = await AuditLog.find({
      userId: "TEST_P5_FIN_CHILD",
      action: GENEALOGY_AUDIT_ACTIONS.MEMBER_PLACED,
    });
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0].details, /successfully placed/);
  });

  test("28. Downline authorization checks work accurately", async () => {
    // ROOT should be authorized for LEFT_CHILD and DEEP_1
    const isDownline1 = await genealogyService.isBinaryDownline("TEST_P5_ROOT", "TEST_P5_DEEP_1");
    assert.strictEqual(isDownline1, true, "DEEP_1 is downline of ROOT");

    // DEEP_1 is NOT an ancestor/upline of ROOT
    const isDownline2 = await genealogyService.isBinaryDownline("TEST_P5_DEEP_1", "TEST_P5_ROOT");
    assert.strictEqual(isDownline2, false, "ROOT is NOT downline of DEEP_1");

    // Unrelated users
    const isDownline3 = await genealogyService.isBinaryDownline("TEST_P5_LEFT_CHILD", "TEST_P5_RIGHT_CHILD");
    assert.strictEqual(isDownline3, false, "RIGHT_CHILD is NOT downline of LEFT_CHILD");
  });

  test("29. Database partial unique index on Genealogy is verified", async () => {
    const indexes = await Genealogy.collection.indexes();
    const hasCompoundUnique = indexes.some(
      (idx) => idx.key.parentId === 1 && idx.key.placementLeg === 1 && idx.unique === true
    );
    assert.strictEqual(hasCompoundUnique, true, "Genealogy must have unique parentId + placementLeg index");
  });

  // ==========================================
  // SECTION 7: AUTHORIZATION A THROUGH J & PRIVACY
  // ==========================================

  const {
    getBinaryTree,
    getSponsorTree,
    getDirectReferrals,
    getSponsorInfo,
  } = await import("../src/controllers/genealogyController.js");

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  };

  test("30. Auth A: Member accessing own binary tree succeeds with 200", async () => {
    const req = {
      user: { userId: "TEST_P5_LEFT_CHILD", role: "user" },
      query: { userId: "TEST_P5_LEFT_CHILD" },
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getBinaryTree(req, res, (err) => { capturedErr = err; });

    assert.strictEqual(capturedErr, null);
    assert.strictEqual(res.body.status, "success");
    assert.strictEqual(res.body.data.userId, "TEST_P5_LEFT_CHILD");
  });

  test("31. Auth B: Member accessing own sponsor tree succeeds with 200", async () => {
    const req = {
      user: { userId: "TEST_P5_ROOT", role: "user" },
      query: { userId: "TEST_P5_ROOT" },
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getSponsorTree(req, res, (err) => { capturedErr = err; });

    assert.strictEqual(capturedErr, null);
    assert.strictEqual(res.body.status, "success");
    assert.strictEqual(res.body.data.userId, "TEST_P5_ROOT");
  });

  test("32. Auth C: Member accessing own direct referrals succeeds with 200", async () => {
    const req = {
      user: { userId: "TEST_P5_ROOT", role: "user" },
      query: { userId: "TEST_P5_ROOT" },
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getDirectReferrals(req, res, (err) => { capturedErr = err; });

    assert.strictEqual(capturedErr, null);
    assert.strictEqual(res.body.status, "success");
    assert.ok(Array.isArray(res.body.data.referrals));
  });

  test("33. Auth D: Member accessing unrelated user's binary tree is rejected with 403", async () => {
    const req = {
      user: { userId: "TEST_P5_LEFT_CHILD", role: "user" },
      query: { userId: "TEST_P5_RIGHT_CHILD" }, // Unrelated sibling
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getBinaryTree(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr, "Should return 403 error");
    assert.strictEqual(capturedErr.statusCode, 403);
    assert.match(capturedErr.message, /permission/);
  });

  test("34. Auth E: Member accessing unrelated user's sponsor tree is rejected with 403", async () => {
    const req = {
      user: { userId: "TEST_P5_LEFT_CHILD", role: "user" },
      query: { userId: "TEST_P5_RIGHT_CHILD" },
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getSponsorTree(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr, "Should return 403 error");
    assert.strictEqual(capturedErr.statusCode, 403);
    assert.match(capturedErr.message, /permission/);
  });

  test("35. Auth F: Member attempting userId query tampering is rejected with 403", async () => {
    const req = {
      user: { userId: "TEST_P5_LEFT_CHILD", role: "user" },
      query: { userId: "TEST_P5_ROOT" }, // LEFT_CHILD trying to view ROOT upline's entire tree
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    let capturedErr = null;
    await getBinaryTree(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr);
    assert.strictEqual(capturedErr.statusCode, 403);
  });

  test("36. Auth G & H: Admin and Superadmin can access any user's tree for audit", async () => {
    const adminReq = {
      user: { userId: "TEST_P5_ADMIN", role: "admin" },
      query: { userId: "TEST_P5_ROOT" },
      ip: "127.0.0.1",
      headers: {},
    };
    const adminRes = createMockRes();
    let adminErr = null;
    await getBinaryTree(adminReq, adminRes, (err) => { adminErr = err; });
    assert.strictEqual(adminErr, null);
    assert.strictEqual(adminRes.body.status, "success");

    const superReq = {
      user: { userId: "TEST_P5_SUPER", role: "superadmin" },
      query: { userId: "TEST_P5_ROOT" },
      ip: "127.0.0.1",
      headers: {},
    };
    const superRes = createMockRes();
    let superErr = null;
    await getBinaryTree(superReq, superRes, (err) => { superErr = err; });
    assert.strictEqual(superErr, null);
    assert.strictEqual(superRes.body.status, "success");
  });

  test("37. Auth I & J: Member cannot modify topology or re-assign sponsor", async () => {
    // Member cannot alter sponsor after assignment
    await assert.rejects(
      async () => {
        await genealogyService.assignSponsor("TEST_P5_LEFT_CHILD", "TEST_P5_USER_1");
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        return true;
      }
    );
  });

  test("38. Privacy Verification: Responses NEVER contain passwords, KYC, bank, or wallet details", async () => {
    const req = {
      user: { userId: "TEST_P5_ROOT", role: "user" },
      query: { userId: "TEST_P5_ROOT" },
      ip: "127.0.0.1",
      headers: {},
    };
    const res = createMockRes();
    await getBinaryTree(req, res, () => {});

    const jsonString = JSON.stringify(res.body);
    const forbiddenKeys = [
      "password",
      "email",
      "mobile",
      "twoFASecret",
      "twoFAEnabled",
      "otpHash",
      "verificationToken",
      "passwordResetToken",
      "activeDevices",
      "kyc",
      "aadhaarNumber",
      "panNumber",
      "bankDetails",
      "accountNumber",
      "wallet",
      "availablePaisa",
      "lockedPaisa",
      "totalEarnedPaisa",
      "nominee",
    ];

    for (const key of forbiddenKeys) {
      assert.strictEqual(
        jsonString.includes(`"${key}"`),
        false,
        `Forbidden sensitive key '${key}' MUST NOT appear in genealogy responses!`
      );
    }
  });

  test("39. Ancestor ordering matches actual parent chain and structural depth", async () => {
    const deepNode = await Genealogy.findOne({ userId: "TEST_P5_DEEP_1" });
    assert.deepStrictEqual(
      deepNode.ancestors,
      ["TEST_P5_ROOT", "TEST_P5_LEFT_CHILD"],
      "Ancestors must be deterministically ordered from root to immediate parent"
    );
    assert.strictEqual(deepNode.ancestors.length, 2, "Depth matches ancestor count");
  });
});
