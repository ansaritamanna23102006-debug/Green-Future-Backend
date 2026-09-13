/**
 * Green Future Tech (GFT) — Pure Deterministic Money Utilities
 * Phase 4: Exact integer minor-unit (Paisa) arithmetic and validation.
 * 
 * Rules:
 * - INR amounts are represented as integer Paisa (1 INR = 100 Paisa).
 * - No floating-point financial representations in stored or authoritative values.
 * - GFT token precision remains unconfirmed and throws UnconfirmedBusinessRuleError.
 */

import { UnconfirmedBusinessRuleError } from "./errors.js";

const MAX_SAFE_PAISA = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991 paisa (~90 Trillion INR)

/**
 * Deterministically parse an INR string or integer into integer Paisa.
 * 
 * Accepted formats:
 * - "1500.25" -> 150025
 * - "100" -> 10000
 * - "100.5" -> 10050
 * - "0.05" -> 5
 * - 100 -> 10000
 * 
 * Rejects:
 * - NaN, Infinity, -Infinity
 * - Negative values (unless allowNegative: true)
 * - Strings with > 2 decimal places (e.g. "10.125")
 * - Non-numeric characters or malformed strings
 * - Values exceeding Number.MAX_SAFE_INTEGER
 * 
 * @param {string|number} input - Amount representation
 * @param {Object} options - Options { allowNegative: boolean }
 * @returns {number} Integer Paisa
 */
export function parseToPaisa(input, options = {}) {
  if (input === null || input === undefined || input === "") {
    throw new Error("Amount input cannot be empty or null.");
  }

  // If already an integer number, check if it's within range
  let str;
  if (typeof input === "number") {
    if (isNaN(input) || !isFinite(input)) {
      throw new Error(`Invalid numeric amount: ${input}. NaN or Infinity is rejected.`);
    }
    str = input.toString();
  } else if (typeof input === "string") {
    str = input.trim();
  } else {
    throw new Error(`Unsupported amount input type: ${typeof input}. Expected string or number.`);
  }

  // Check for negative
  const isNegative = str.startsWith("-");
  if (isNegative && !options.allowNegative) {
    throw new Error(`Negative amounts are not permitted: "${str}".`);
  }

  const cleanStr = isNegative ? str.slice(1) : str;

  // Regex strictly matching digits with optional 1 or 2 decimal places
  const inrRegex = /^\d+(\.\d{1,2})?$/;
  if (!inrRegex.test(cleanStr)) {
    throw new Error(`Malformed amount string: "${str}". Must be numeric with at most 2 decimal places.`);
  }

  const parts = cleanStr.split(".");
  const wholePart = parts[0];
  const fractionPart = parts.length > 1 ? parts[1].padEnd(2, "0") : "00";

  // Combine whole and fraction
  const combinedStr = (wholePart === "0" && fractionPart === "00") ? "0" : `${wholePart}${fractionPart}`.replace(/^0+/, "") || "0";
  const paisa = Number(combinedStr) * (isNegative ? -1 : 1);

  if (!Number.isSafeInteger(paisa) || Math.abs(paisa) > MAX_SAFE_PAISA) {
    throw new Error(`Amount exceeds safe integer range: "${str}".`);
  }

  return paisa;
}

/**
 * Format integer Paisa into a standard INR string representation (e.g. "1500.25").
 * 
 * @param {number} paisa - Integer Paisa
 * @returns {string} Formatted INR decimal string
 */
export function formatPaisaToRupees(paisa) {
  if (typeof paisa !== "number" || isNaN(paisa) || !isFinite(paisa) || !Number.isSafeInteger(paisa)) {
    throw new Error(`Invalid paisa value for formatting: ${paisa}. Must be a safe integer.`);
  }

  const isNeg = paisa < 0;
  const absPaisa = Math.abs(paisa);
  const whole = Math.floor(absPaisa / 100);
  const frac = (absPaisa % 100).toString().padStart(2, "0");

  return `${isNeg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Convert GFT token quantity to base minor units.
 * 
 * CRITICAL SAFETY GATE:
 * Token precision is NOT confirmed by the client.
 * Any attempt to assume or convert token precision throws UnconfirmedBusinessRuleError.
 */
export function parseTokenUnits(input) {
  throw new UnconfirmedBusinessRuleError(
    "GFT token precision and economic denominations remain unconfirmed by client specification. Operation blocked."
  );
}
