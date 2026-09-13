/**
 * Green Future Tech (GFT) — Pure Withdrawal Rules
 * Phase 0: Withdrawal configuration gating and address format validators.
 * 
 * IMPORTANT:
 * - Withdrawal minimums, fees, and limits are marked REQUIRES_CLIENT_CONFIRMATION.
 * - Live withdrawal calculation/deductions must NOT execute with unconfirmed parameters.
 * - Address validation is strictly FORMAT validation (syntax regex), NOT live blockchain verification.
 */

import { WITHDRAWAL_CONFIG, RULE_STATUS } from "./businessPlanConfig.js";
import { UnconfirmedBusinessRuleError } from "../errors.js";

/**
 * Standard TRON (TRC-20) address format regex:
 * Starts with 'T', 34 characters total, Base58 alphabet (no 0, O, I, l).
 */
export const TRON_ADDRESS_FORMAT_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Standard BSC (BEP-20) / Ethereum address format regex:
 * Starts with '0x', followed by 40 hexadecimal characters.
 */
export const BSC_ADDRESS_FORMAT_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Pure function: Validate crypto wallet address syntax by network.
 * 
 * NOTE: This is strictly a syntax format check, NOT an on-chain verification.
 * 
 * @param {string} address - Crypto wallet address string
 * @param {string} network - "TRC20" | "BEP20"
 * @returns {object} { isValid: boolean, network: string, note: string }
 */
export function validateAddressFormat(address, network = "TRC20") {
  const cleanAddr = String(address || "").trim();
  const cleanNet = String(network || "").toUpperCase().trim();

  if (!cleanAddr) {
    return {
      isValid: false,
      network: cleanNet,
      error: "Address string cannot be empty.",
      isFormatOnly: true,
    };
  }

  if (cleanNet === "TRC20" || cleanNet === "TRON") {
    const matches = TRON_ADDRESS_FORMAT_REGEX.test(cleanAddr);
    return {
      isValid: matches,
      network: "TRC20",
      error: matches ? null : "Invalid TRON (TRC20) address format. Must begin with 'T' and contain exactly 34 Base58 characters.",
      isFormatOnly: true,
      note: "Syntax format validation only; does not query the TRON blockchain.",
    };
  }

  if (cleanNet === "BEP20" || cleanNet === "BSC") {
    const matches = BSC_ADDRESS_FORMAT_REGEX.test(cleanAddr);
    return {
      isValid: matches,
      network: "BEP20",
      error: matches ? null : "Invalid BSC (BEP20) address format. Must begin with '0x' followed by 40 hexadecimal characters.",
      isFormatOnly: true,
      note: "Syntax format validation only; does not query the Binance Smart Chain.",
    };
  }

  return {
    isValid: false,
    network: cleanNet,
    error: `Unsupported network '${cleanNet}' for format validation. Supported: TRC20, BEP20.`,
    isFormatOnly: true,
  };
}

/**
 * Pure function: Check if withdrawal limits are confirmed and can execute live.
 * 
 * Currently returns false because withdrawal minimums and fee structure
 * are marked REQUIRES_CLIENT_CONFIRMATION.
 */
export function assertWithdrawalRulesExecutable() {
  const minINR = WITHDRAWAL_CONFIG.minWithdrawalINR;
  const feePct = WITHDRAWAL_CONFIG.processingFeePercentage;

  if (
    minINR.confirmationStatus !== RULE_STATUS.CONFIRMED ||
    feePct.confirmationStatus !== RULE_STATUS.CONFIRMED
  ) {
    throw new UnconfirmedBusinessRuleError(
      "Cannot execute live withdrawal deductions: Withdrawal limits and fee structure are pending client confirmation.",
      { withdrawalConfig: WITHDRAWAL_CONFIG }
    );
  }

  return true;
}
