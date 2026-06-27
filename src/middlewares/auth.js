import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AppError from "../utils/errors.js";

// Verify JWT token and attach user to req
export const protect = async (req, res, next) => {
  try {
    let token;
    
    // Check if token exists in Authorization Header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token || token === "null" || token === "undefined") {
      return next(
        new AppError("You are not logged in. Please log in to gain access.", 401)
      );
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user in database
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(
        new AppError("The user belonging to this token no longer exists.", 401)
      );
    }

    if (user.status === "suspended") {
      return next(
        new AppError("Your account has been suspended. Contact support.", 403)
      );
    }

    // Attach user payload to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new AppError("Invalid or malformed token. Please log in again.", 401));
    }
    if (error.name === "TokenExpiredError") {
      return next(new AppError("Your session token has expired. Please log in again.", 401));
    }
    next(error);
  }
};

// Restrict access to specific roles
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError("You do not have permission to perform this action.", 403)
      );
    }
    next();
  };
};
