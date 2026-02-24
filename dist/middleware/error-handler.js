"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler
// Harus dipasang paling bawah di Express (setelah semua route)
// Menangani: ZodError (validasi), error umum, dan error server
// ─────────────────────────────────────────────────────────────────────────────
function errorHandler(err, req, res, _next) {
    // Zod validation error — request body/query tidak valid
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            error: "Validation error",
            details: err.issues.map((e) => ({
                field: e.path.join("."),
                message: e.message,
            })),
        });
        return;
    }
    // Error dengan status code custom (misal: 404, 403)
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = status === 500
        ? "Internal server error"
        : error.message || "Something went wrong";
    // Log error 500 ke file
    if (status === 500) {
        logger_1.logger.error(`${req.method} ${req.originalUrl} — ${message}`, { err });
    }
    res.status(status).json({ error: message });
}
//# sourceMappingURL=error-handler.js.map