"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = require("express-rate-limit");
const logger_1 = require("./utils/logger");
const error_handler_1 = require("./middleware/error-handler");
const request_logger_1 = require("./middleware/request-logger");
const markets_1 = __importDefault(require("./routes/markets"));
const orderbook_1 = __importDefault(require("./routes/orderbook"));
const auth_1 = __importDefault(require("./routes/auth"));
const user_1 = __importDefault(require("./routes/user"));
const sync_markets_1 = require("./jobs/sync-markets");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || "3000", 10);
// ─── Security ───────────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: "*", // ganti dengan URL Aurora app saat production
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
// ─── Rate Limiting ───────────────────────────────────────────────────────────
// Max 100 request per menit per IP
app.use("/api", (0, express_rate_limit_1.rateLimit)({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
}));
// ─── Body Parser ────────────────────────────────────────────────────────────
app.use(express_1.default.json({ limit: "1mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
// ─── Request Logger ──────────────────────────────────────────────────────────
app.use(request_logger_1.requestLogger);
// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
    });
});
// ─── API Routes ──────────────────────────────────────────────────────────────
app.use("/api/markets", markets_1.default);
app.use("/api/orderbook", orderbook_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/user", user_1.default);
// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
});
// ─── Global Error Handler (harus paling bawah) ──────────────────────────────
app.use(error_handler_1.errorHandler);
// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    logger_1.logger.info(`🚀 Aurora Backend running on http://localhost:${PORT}`);
    logger_1.logger.info(`📊 Environment : ${process.env.NODE_ENV || "development"}`);
    logger_1.logger.info(`🗄️  Database    : PostgreSQL via Prisma ORM`);
    // Start background cron job — sync market dari Polymarket
    (0, sync_markets_1.startSyncJob)();
});
exports.default = app;
//# sourceMappingURL=index.js.map