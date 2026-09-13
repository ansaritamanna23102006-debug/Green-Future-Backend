export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class UnconfirmedBusinessRuleError extends AppError {
  constructor(message, details = {}) {
    super(message, 400);
    this.name = "UnconfirmedBusinessRuleError";
    this.code = "UNCONFIRMED_BUSINESS_RULE";
    this.details = details;
  }
}

export default AppError;

