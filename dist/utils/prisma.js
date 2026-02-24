"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
// Singleton pattern — satu instance PrismaClient untuk seluruh aplikasi
const prisma = new client_1.PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
// Connect ke database saat aplikasi start
prisma
    .$connect()
    .then(() => {
    logger_1.logger.info("✅ PostgreSQL connected via Prisma");
})
    .catch((err) => {
    logger_1.logger.error("❌ Failed to connect to PostgreSQL:", {
        message: err.message,
    });
    process.exit(1);
});
exports.default = prisma;
//# sourceMappingURL=prisma.js.map