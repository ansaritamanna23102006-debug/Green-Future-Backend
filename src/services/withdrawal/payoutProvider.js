import AppError from "../../utils/errors.js";
import logger from "../../config/logger.js";

/**
 * Base Payout Provider Interface
 */
export class BasePayoutProvider {
  async createPayout(withdrawal) {
    throw new Error("createPayout must be implemented by subclass.");
  }

  async getPayoutStatus(providerReference) {
    throw new Error("getPayoutStatus must be implemented by subclass.");
  }
}

/**
 * Sandbox Payout Adapter for isolated testing and development.
 * Unmistakably marked as SANDBOX.
 */
export class SandboxPayoutAdapter extends BasePayoutProvider {
  constructor(options = {}) {
    super();
    this.shouldFail = options.shouldFail || false;
    this.failureMessage = options.failureMessage || "Simulated sandbox payout processor rejection.";
  }

  setSimulatedFailure(shouldFail, failureMessage) {
    this.shouldFail = shouldFail;
    if (failureMessage) this.failureMessage = failureMessage;
  }

  async createPayout(withdrawal) {
    if (this.shouldFail) {
      logger.warn(`[SANDBOX PAYOUT] Simulated failure for withdrawal ${withdrawal._id}`);
      return {
        success: false,
        status: "FAILED",
        providerReference: `PAYOUT:SANDBOX:FAILED:${withdrawal._id}`,
        failureReason: this.failureMessage,
        isSandbox: true,
      };
    }

    const providerReference = `PAYOUT:SANDBOX:${withdrawal._id}`;
    logger.info(`[SANDBOX PAYOUT] Executed sandbox payout for withdrawal ${withdrawal._id}. Ref: ${providerReference}`);

    return {
      success: true,
      status: "COMPLETED",
      providerReference,
      netAmountPaisa: withdrawal.netAmountPaisa,
      destinationType: withdrawal.destinationType,
      isSandbox: true,
    };
  }

  async getPayoutStatus(providerReference) {
    return {
      providerReference,
      status: "COMPLETED",
      isSandbox: true,
    };
  }
}

/**
 * Production Payout Adapter (strictly disabled until client confirms banking/provider partner).
 */
export class ProductionPayoutAdapter extends BasePayoutProvider {
  async createPayout() {
    throw new AppError(
      "Production payout provider is not configured. Real withdrawal execution is BLOCKED.",
      503
    );
  }

  async getPayoutStatus() {
    throw new AppError(
      "Production payout provider is not configured.",
      503
    );
  }
}

// Default export uses Sandbox adapter in test/development, or Production adapter in production
const payoutProvider = process.env.NODE_ENV === "production"
  ? new ProductionPayoutAdapter()
  : new SandboxPayoutAdapter();

export default payoutProvider;
