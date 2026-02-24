"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSyncJob = startSyncJob;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = require("../utils/logger");
const market_service_1 = require("../services/market.service");
let isRunning = false;
// ─────────────────────────────────────────────────────────────────────────────
// startSyncJob
// Jadwalkan sync market dari Polymarket secara berkala
// Default: setiap 5 menit ("*/5 * * * *")
//
// Flow:
// 1. Saat server start → langsung sync sekali (delay 3 detik)
// 2. Setelah itu sync otomatis sesuai jadwal cron
// ─────────────────────────────────────────────────────────────────────────────
function startSyncJob() {
    const interval = process.env.SYNC_MARKETS_INTERVAL || "*/5 * * * *";
    // Validasi cron expression
    if (!node_cron_1.default.validate(interval)) {
        logger_1.logger.error(`Invalid cron expression: "${interval}"`);
        return;
    }
    logger_1.logger.info(`📅 Market sync scheduled: "${interval}"`);
    // Schedule cron job
    node_cron_1.default.schedule(interval, async () => {
        // Skip jika job sebelumnya masih berjalan (hindari overlap)
        if (isRunning) {
            logger_1.logger.warn("Sync job still running — skipping this tick");
            return;
        }
        isRunning = true;
        try {
            const { count, duration } = await (0, market_service_1.syncMarketsFromPolymarket)();
            logger_1.logger.info(`✅ Scheduled sync done: ${count} markets in ${duration}ms`);
        }
        catch (err) {
            logger_1.logger.error("Scheduled sync failed:", {
                message: err.message,
            });
        }
        finally {
            isRunning = false;
        }
    });
    // Jalankan sekali langsung saat server start
    // Delay 3 detik supaya DB connection sudah siap
    setTimeout(async () => {
        if (isRunning)
            return;
        isRunning = true;
        logger_1.logger.info("🚀 Running initial market sync on startup...");
        try {
            const { count, duration } = await (0, market_service_1.syncMarketsFromPolymarket)();
            logger_1.logger.info(`✅ Initial sync done: ${count} markets in ${duration}ms`);
        }
        catch (err) {
            logger_1.logger.warn("Initial sync failed (non-fatal):", {
                message: err.message,
            });
        }
        finally {
            isRunning = false;
        }
    }, 3000);
}
//# sourceMappingURL=sync-markets.js.map