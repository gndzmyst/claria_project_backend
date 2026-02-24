"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMarkets = getMarkets;
exports.getMarketDetail = getMarketDetail;
exports.syncMarketsFromPolymarket = syncMarketsFromPolymarket;
const prisma_1 = __importDefault(require("../utils/prisma"));
const cache_1 = require("../utils/cache");
const logger_1 = require("../utils/logger");
const polymarket_service_1 = require("./polymarket.service");
const CACHE_TTL = parseInt(process.env.CACHE_MARKETS_TTL || "60");
// ─────────────────────────────────────────────────────────────────────────────
// Helper: normalizeCategory
// Konversi kategori bebas dari Polymarket → kategori Aurora yang konsisten
// ─────────────────────────────────────────────────────────────────────────────
function normalizeCategory(raw) {
    const lower = (raw || "").toLowerCase();
    if (lower.includes("crypto") ||
        lower.includes("bitcoin") ||
        lower.includes("ethereum") ||
        lower.includes("btc") ||
        lower.includes("eth") ||
        lower.includes("defi"))
        return "Crypto";
    if (lower.includes("politic") ||
        lower.includes("election") ||
        lower.includes("government") ||
        lower.includes("trump") ||
        lower.includes("president") ||
        lower.includes("congress"))
        return "Politics";
    if (lower.includes("sport") ||
        lower.includes("football") ||
        lower.includes("soccer") ||
        lower.includes("nba") ||
        lower.includes("nfl") ||
        lower.includes("tennis") ||
        lower.includes("baseball"))
        return "Sports";
    return "Trending";
}
// ─────────────────────────────────────────────────────────────────────────────
// Helper: transformMarket
// Konversi format GammaMarket → format yang disimpan di DB Aurora
// ─────────────────────────────────────────────────────────────────────────────
function transformMarket(g) {
    // Parse outcome_prices dari JSON string ke object
    let outcomePrices = {};
    try {
        const prices = JSON.parse(g.outcome_prices || "[]");
        const outcomes = g.outcomes || ["Yes", "No"];
        outcomes.forEach((outcome, i) => {
            outcomePrices[outcome] = parseFloat(prices[i] || "0");
        });
    }
    catch {
        outcomePrices = { Yes: 0.5, No: 0.5 };
    }
    return {
        id: g.condition_id || g.id,
        polymarketId: g.id,
        slug: g.slug || g.id,
        question: g.question || "Unknown Market",
        description: g.description || null,
        category: normalizeCategory(g.category || ""),
        tags: Array.isArray(g.tags) ? g.tags : [],
        outcomes: Array.isArray(g.outcomes) ? g.outcomes : ["Yes", "No"],
        outcomePrices,
        tokens: Array.isArray(g.tokens) ? g.tokens : [],
        volume: parseFloat(g.volume || "0"),
        volume24h: parseFloat(g.volume_24hr || "0"),
        liquidity: parseFloat(g.liquidity || "0"),
        active: g.active ?? true,
        closed: g.closed ?? false,
        imageUrl: g.image || null,
        icon: g.icon || null,
        endDate: g.end_date_iso ? new Date(g.end_date_iso) : null,
        startDate: g.start_date_iso ? new Date(g.start_date_iso) : null,
        eventId: g.event_id || null,
        lastSyncedAt: new Date(),
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// getMarkets
// Ambil daftar market dari DB (dengan fallback ke Polymarket jika DB kosong)
// ─────────────────────────────────────────────────────────────────────────────
async function getMarkets(params) {
    const cacheKey = `markets:${JSON.stringify(params || {})}`;
    return cache_1.cache.getOrSet(cacheKey, async () => {
        // Build where clause untuk Prisma
        const where = {
            active: true,
            closed: false,
        };
        // Filter kategori (kecuali Trending dan New yang tampilkan semua)
        if (params?.category &&
            params.category !== "Trending" &&
            params.category !== "New") {
            where.category = params.category;
        }
        // Filter pencarian
        if (params?.search) {
            where.question = {
                contains: params.search,
                mode: "insensitive",
            };
        }
        // Query ke DB via Prisma ORM
        const markets = await prisma_1.default.market.findMany({
            where,
            orderBy: params?.category === "New"
                ? { createdAt: "desc" }
                : { volume24h: "desc" },
            take: params?.limit ?? 20,
            skip: params?.offset ?? 0,
        });
        // Jika DB belum ada data (belum sync), ambil langsung dari Polymarket
        if (markets.length === 0) {
            logger_1.logger.info("DB kosong — fetching live dari Polymarket Gamma API...");
            const gammaMarkets = await (0, polymarket_service_1.fetchGammaMarkets)({
                limit: params?.limit ?? 20,
                active: true,
            });
            return gammaMarkets.map((g) => ({
                ...transformMarket(g),
                _source: "polymarket_live",
            }));
        }
        return markets.map((m) => ({ ...m, _source: "database" }));
    }, CACHE_TTL);
}
// ─────────────────────────────────────────────────────────────────────────────
// getMarketDetail
// Ambil detail satu market by id, slug, atau polymarketId
// ─────────────────────────────────────────────────────────────────────────────
async function getMarketDetail(idOrSlug) {
    const cacheKey = `market:${idOrSlug}`;
    return cache_1.cache.getOrSet(cacheKey, async () => {
        // Cari di DB via Prisma ORM
        const market = await prisma_1.default.market.findFirst({
            where: {
                OR: [
                    { id: idOrSlug },
                    { slug: idOrSlug },
                    { polymarketId: idOrSlug },
                ],
            },
        });
        if (market)
            return market;
        // Fallback: ambil langsung dari Polymarket
        logger_1.logger.info(`Market ${idOrSlug} tidak ada di DB, fetch dari Polymarket...`);
        const gammaMarket = await (0, polymarket_service_1.fetchGammaMarketById)(idOrSlug);
        return transformMarket(gammaMarket);
    }, CACHE_TTL);
}
// ─────────────────────────────────────────────────────────────────────────────
// syncMarketsFromPolymarket
// Dijalankan oleh cron job — ambil semua market dari Polymarket dan simpan ke DB
// ─────────────────────────────────────────────────────────────────────────────
async function syncMarketsFromPolymarket() {
    const startTime = Date.now();
    let count = 0;
    try {
        logger_1.logger.info("⏳ Starting market sync from Polymarket...");
        // Fetch dari berbagai kategori secara berurutan
        const categories = ["crypto", "politics", "sports", ""];
        const allMarkets = [];
        for (const category of categories) {
            try {
                const batch = await (0, polymarket_service_1.fetchGammaMarkets)({
                    limit: 100,
                    active: true,
                    closed: false,
                    ...(category ? { category } : {}),
                });
                allMarkets.push(...batch);
                logger_1.logger.debug(`Fetched ${batch.length} markets for category: "${category || "all"}"`);
            }
            catch (err) {
                logger_1.logger.warn(`Failed to fetch category "${category}": ${err.message}`);
            }
        }
        // Deduplicate berdasarkan condition_id
        const uniqueMarkets = new Map();
        allMarkets.forEach((m) => {
            const key = m.condition_id || m.id;
            if (key)
                uniqueMarkets.set(key, m);
        });
        logger_1.logger.info(`Processing ${uniqueMarkets.size} unique markets...`);
        // Upsert setiap market ke DB via Prisma ORM
        const results = await Promise.allSettled(Array.from(uniqueMarkets.values()).map((g) => {
            const marketData = transformMarket(g);
            return prisma_1.default.market.upsert({
                where: { id: marketData.id },
                create: marketData,
                update: {
                    outcomePrices: marketData.outcomePrices,
                    volume: marketData.volume,
                    volume24h: marketData.volume24h,
                    liquidity: marketData.liquidity,
                    active: marketData.active,
                    closed: marketData.closed,
                    lastSyncedAt: new Date(),
                },
            });
        }));
        // Hitung berhasil dan gagal
        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.filter((r) => r.status === "rejected").length;
        count = succeeded;
        if (failed > 0) {
            logger_1.logger.warn(`${failed} markets failed to upsert`);
        }
        // Invalidate semua cache market
        cache_1.cache.deleteByPrefix("markets:");
        cache_1.cache.deleteByPrefix("market:");
        const duration = Date.now() - startTime;
        logger_1.logger.info(`✅ Sync complete: ${succeeded} markets saved | ${failed} failed | ${duration}ms`);
        // Simpan log sync ke DB
        await prisma_1.default.syncLog.create({
            data: {
                type: "markets",
                status: "success",
                count,
                duration,
            },
        });
        return { count, duration };
    }
    catch (err) {
        const duration = Date.now() - startTime;
        const message = err instanceof Error ? err.message : "Unknown error";
        logger_1.logger.error(`❌ Sync failed: ${message}`);
        await prisma_1.default.syncLog.create({
            data: {
                type: "markets",
                status: "failed",
                count,
                duration,
                error: message,
            },
        });
        throw err;
    }
}
//# sourceMappingURL=market.service.js.map