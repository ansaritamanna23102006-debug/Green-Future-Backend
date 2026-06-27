import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "path";

// Configs and Helpers
import logger from "./config/logger.js";
import globalErrorHandler from "./middlewares/errorHandler.js";
import AppError from "./utils/errors.js";

// Routes Imports
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import genealogyRoutes from "./routes/genealogyRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import superadminRoutes from "./routes/superadminRoutes.js";

const app = express();

// 1. Logging Middleware (Morgan streaming into Winston)
app.use(
  morgan(":method :url :status :res[content-length] - :response-time ms", {
    stream: logger.stream,
  })
);

// 2. Security Headers (Helmet)
app.use(helmet());

// 3. CORS Configuration
app.use((req, res, next) => {
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

// 4. Rate Limiter (Limit excessive requests to prevent brute-force)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use("/api/", limiter);

// 5. Body Parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 6. Data Sanitization against NoSQL Query Injection
app.use(mongoSanitize());

// Static file serving for uploads folder
app.use("/uploads", express.static(path.join("uploads")));

// 7. API Version 1 Route Mappings
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/genealogy", genealogyRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/superadmin", superadminRoutes);

// 8. Health Check Endpoint
app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    status: "success",
    timestamp: new Date(),
    uptime: process.uptime(),
    message: "GFT Backend System is running smoothly",
  });
});

// 9. Unmapped Routes Handler
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// 10. Global Error Handler Middleware
app.use(globalErrorHandler);

export default app;
