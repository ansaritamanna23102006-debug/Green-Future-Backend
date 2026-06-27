import logger from "../config/logger.js";
import AppError from "../utils/errors.js";

export const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (process.env.NODE_ENV === "development") {
    logger.error(`Error details: ${err.message}`, err);
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  } else {
    // Production Mode
    logger.error(`Production Error: ${err.message}`);

    // Mongoose duplicate key error
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      const message = `Duplicate value entered for field: ${field}. Please use another value.`;
      err = new AppError(message, 400);
    }

    // Mongoose validation error
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((el) => el.message);
      const message = `Invalid input data: ${messages.join(". ")}`;
      err = new AppError(message, 400);
    }

    // JWT Errors
    if (err.name === "JsonWebTokenError") {
      err = new AppError("Invalid token. Please log in again.", 401);
    }
    if (err.name === "TokenExpiredError") {
      err = new AppError("Your session token has expired. Please log in again.", 401);
    }

    if (err.isOperational) {
      return res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
      });
    }

    // Generic system errors
    return res.status(500).json({
      status: "error",
      message: "Something went wrong on the server.",
    });
  }
};

export default globalErrorHandler;
