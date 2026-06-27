import { validationResult } from "express-validator";
import { errorResponse } from "../utils/response.js";

// General validator checker middleware
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors.array().map((err) => `${err.path}: ${err.msg}`).join(", ");
    return errorResponse(res, errorMsg, 400);
  }
  next();
};
