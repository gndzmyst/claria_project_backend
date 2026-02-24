import cron from "node-cron";
import { logger } from "../utils/logger";
import { syncMarketsFromPolymarket } from "../services/market.service";

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
export function startSyncJob(): void {
  const interval = process.env.SYNC_MARKETS_INTERVAL || "*/5 * * * *";

  // Validasi cron expression
  if (!cron.validate(interval)) {
    logger.error(`Invalid cron expression: "${interval}"`);
    return;
  }

  logger.info(`📅 Market sync scheduled: "${interval}"`);

  // Schedule cron job
  cron.schedule(interval, async () => {
    // Skip jika job sebelumnya masih berjalan (hindari overlap)
    if (isRunning) {
      logger.warn("Sync job still running — skipping this tick");
      return;
    }

    isRunning = true;
    try {
      const { count, duration } = await syncMarketsFromPolymarket();
      logger.info(`✅ Scheduled sync done: ${count} markets in ${duration}ms`);
    } catch (err) {
      logger.error("Scheduled sync failed:", {
        message: (err as Error).message,
      });
    } finally {
      isRunning = false;
    }
  });

  // Jalankan sekali langsung saat server start
  // Delay 3 detik supaya DB connection sudah siap
  setTimeout(async () => {
    if (isRunning) return;
    isRunning = true;
    logger.info("🚀 Running initial market sync on startup...");
    try {
      const { count, duration } = await syncMarketsFromPolymarket();
      logger.info(`✅ Initial sync done: ${count} markets in ${duration}ms`);
    } catch (err) {
      logger.warn("Initial sync failed (non-fatal):", {
        message: (err as Error).message,
      });
    } finally {
      isRunning = false;
    }
  }, 3000);
}
