import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/request-logger";

import marketsRouter from "./routes/markets";
import orderbookRouter from "./routes/orderbook";
import authRouter from "./routes/auth";
import userRouter from "./routes/user";
import { startSyncJob } from "./jobs/sync-markets";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ─── Security ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: "*", // ganti dengan URL Aurora app saat production
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Rate Limiting ───────────────────────────────────────────────────────────
// Max 100 request per menit per IP
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  }),
);

// ─── Body Parser ────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logger ──────────────────────────────────────────────────────────
app.use(requestLogger);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use("/api/markets", marketsRouter);
app.use("/api/orderbook", orderbookRouter);
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Global Error Handler (harus paling bawah) ──────────────────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 Aurora Backend running on http://localhost:${PORT}`);
  logger.info(`📊 Environment : ${process.env.NODE_ENV || "development"}`);
  logger.info(`🗄️  Database    : PostgreSQL via Prisma ORM`);

  // Start background cron job — sync market dari Polymarket
  startSyncJob();
});

export default app;
