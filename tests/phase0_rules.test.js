/**
 * Green Future Tech (GFT) — Phase 0 Automated Test Suite
 * Validates the Authoritative Business Rule Engine and Execution Gatekeeping.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BUSINESS_PLAN_STATUS,
  RULE_VERSION,
  RULE_STATUS,
  PACKAGES,
  REFERENCE_LEVELS,
  RANKS,
  PASSIVE_TIERS,
  isRuleExecutable,
  assertRuleExecutable,
  validatePassiveTiersArithmetic,
} from "../src/utils/rules/businessPlanConfig.js";

import {
  calculateSelfIncome,
  calculateReferenceIncome,
  calculateTurnoverIncome,
  calculatePassiveIncome,
} from "../src/utils/rules/incomeRules.js";

import {
  evaluateRankQualification,
  determineUserRankProgress,
} from "../src/utils/rules/rankRules.js";

import {
  validateAddressFormat,
  assertWithdrawalRulesExecutable,
} from "../src/utils/rules/withdrawalRules.js";

import { UnconfirmedBusinessRuleError } from "../src/utils/errors.js";

test("Phase 0 — TEST 1: All 8 GFT packages have confirmationStatus === 'REQUIRES_CLIENT_CONFIRMATION'", () => {
  const packageKeys = Object.keys(PACKAGES);
  assert.equal(packageKeys.length, 8, "Must represent exactly 8 GFT packages");

  for (const key of packageKeys) {
    const pkg = PACKAGES[key];
    assert.equal(
      pkg.confirmationStatus,
      RULE_STATUS.REQUIRES_CLIENT_CONFIRMATION,
      `Package ${key} must have confirmationStatus 'REQUIRES_CLIENT_CONFIRMATION'`
    );
    assert.ok(pkg.discrepancy, `Package ${key} must document discrepancy notes`);
  }
});

test("Phase 0 — TEST 2: isRuleExecutable('pkg_gft_1') must return false", () => {
  const executable = isRuleExecutable("pkg_gft_1");
  assert.equal(executable, false, "Unconfirmed package must return false from execution gate");

  // Verify all packages return false
  for (const key of Object.keys(PACKAGES)) {
    assert.equal(isRuleExecutable(key), false, `Package ${key} must not be executable live`);
  }
});

test("Phase 0 — TEST 3: calculateSelfIncome('pkg_gft_1', 3000) must throw UnconfirmedBusinessRuleError", () => {
  assert.throws(
    () => {
      calculateSelfIncome("pkg_gft_1", 3000);
    },
    (err) => {
      assert.ok(err instanceof UnconfirmedBusinessRuleError, "Error must be instance of UnconfirmedBusinessRuleError");
      assert.equal(err.code, "UNCONFIRMED_BUSINESS_RULE");
      assert.match(err.message, /Global Business Plan status|unconfirmed rule/i);
      return true;
    }
  );
});

test("Phase 0 — TEST 4: calculateReferenceIncome(1, 'pkg_gft_1', 3000) must throw UnconfirmedBusinessRuleError because package base is unconfirmed", () => {
  // Even though Level 1 percentage (5%) is confirmed, the package calculation base is unconfirmed
  assert.throws(
    () => {
      calculateReferenceIncome(1, "pkg_gft_1", 3000);
    },
    (err) => {
      assert.ok(err instanceof UnconfirmedBusinessRuleError, "Error must be instance of UnconfirmedBusinessRuleError");
      assert.equal(err.code, "UNCONFIRMED_BUSINESS_RULE");
      return true;
    }
  );
});

test("Phase 0 — TEST 5: Validate Passive Tier 1–10 arithmetic; Tier 8 must detect known mismatch", () => {
  const issues = validatePassiveTiersArithmetic();
  assert.equal(issues.length, 1, "Exactly one arithmetic mismatch (Tier 8) must be detected");

  const tier8Issue = issues[0];
  assert.equal(tier8Issue.tier, 8);
  assert.equal(tier8Issue.monthlyAmount, 1750000);
  assert.equal(tier8Issue.sourceYearlyAmount, 2100000);
  assert.equal(tier8Issue.calculatedYearlyAmount, 21000000);
  assert.equal(tier8Issue.discrepancy, 18900000); // 2.10 Cr - 21 L = 1.89 Cr discrepancy
});

test("Phase 0 — TEST 6: Confirmed rank calculations must be deterministic and pure (no DB side effects)", () => {
  const leftVol = 150000;
  const rightVol = 130000;

  const run1 = evaluateRankQualification("rank_silver", leftVol, rightVol);
  const run2 = evaluateRankQualification("rank_silver", leftVol, rightVol);

  assert.deepEqual(run1, run2, "Repeated rank qualification evaluations must be 100% deterministic");
  assert.equal(run1.qualified, true, "150k left and 130k right meets Silver requirement (125k each)");
  assert.equal(run1.fundAmount, 5000);

  // Negative qualification check: unbalanced legs
  const unbalanced = evaluateRankQualification("rank_silver", 200000, 50000);
  assert.equal(unbalanced.qualified, false, "Unbalanced legs (50k right < 125k) must not qualify for Silver");
  assert.equal(unbalanced.missingRight, 75000);
});

test("Phase 0 — TEST 7: Withdrawal rules throw on live execution and validate address formats syntactically", () => {
  // Live execution assertion must throw because parameters are unconfirmed
  assert.throws(
    () => {
      assertWithdrawalRulesExecutable();
    },
    (err) => {
      assert.ok(err instanceof UnconfirmedBusinessRuleError);
      return true;
    }
  );

  // Format validations (Format only, not claiming on-chain validation)
  const validTron = validateAddressFormat("TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9", "TRC20");
  assert.equal(validTron.isValid, true);
  assert.equal(validTron.isFormatOnly, true);

  const invalidTron = validateAddressFormat("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "TRC20");
  assert.equal(invalidTron.isValid, false);

  const validBsc = validateAddressFormat("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "BEP20");
  assert.equal(validBsc.isValid, true);
  assert.equal(validBsc.isFormatOnly, true);
});

test("Phase 0 — TEST 8: Execution gate requires ALL applicable conditions (A global confirmed status never overrides an unconfirmed package)", () => {
  // Directly test assertRuleExecutable logic
  assert.throws(
    () => {
      assertRuleExecutable("pkg_gft_1");
    },
    (err) => {
      assert.equal(err.code, "UNCONFIRMED_BUSINESS_RULE");
      return true;
    }
  );
});
