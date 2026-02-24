"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const logger_1 = require("../utils/logger");
// ─────────────────────────────────────────────────────────────────────────────
// Request Logger Middleware
// Log setiap HTTP request yang masuk beserta response time-nya
// ─────────────────────────────────────────────────────────────────────────────
function requestLogger(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? "warn" : "debug";
        logger_1.logger[level](`${req.method} ${req.originalUrl} → ${res.statusCode} [${duration}ms]`);
    });
    next();
}
//# sourceMappingURL=request-logger.js.map