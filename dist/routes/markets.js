"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const market_service_1 = require("../services/market.service");
const cache_1 = require("../utils/cache");
const polymarket_service_1 = require("../services/polymarket.service");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets
// Ambil daftar market dengan filter opsional
// Query: category, limit, offset, search
// ─────────────────────────────────────────────────────────────────────────────
const marketsQuerySchema = zod_1.z.object({
    category: zod_1.z
        .enum(["Trending", "New", "Politics", "Sports", "Crypto"])
        .optional(),
    limit: zod_1.z.coerce.number().min(1).max(100).default(20),
    offset: zod_1.z.coerce.number().min(0).default(0),
    search: zod_1.z.string().min(1).max(100).optional(),
});
router.get("/", async (req, res, next) => {
    try {
        const query = marketsQuerySchema.parse(req.query);
        const markets = await (0, market_service_1.getMarkets)(query);
        res.json({ data: markets, total: markets.length });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets/:id
// Detail satu market — id bisa berupa conditionId, polymarketId, atau slug
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
    try {
        const market = await (0, market_service_1.getMarketDetail)(req.params.id);
        if (!market) {
            res.status(404).json({ error: "Market not found" });
            return;
        }
        res.json({ data: market });
    }
    catch (err) {
        next(err);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets/:id/price-history
// Data harga historis untuk chart di Aurora app
// Query: interval (1m|1h|6h|1d|1w|all), outcome (Yes|No|nama lain)
// Response format sesuai LineChart dari gifted-charts: [{value, label, timestamp}]
// ─────────────────────────────────────────────────────────────────────────────
const priceHistorySchema = zod_1.z.object({
    interval: zod_1.z.enum(["1m", "1h", "6h", "1d", "1w", "all"]).default("1d"),
    outcome: zod_1.z.string().default("Yes"),
});
router.get("/:id/price-history", async (req, res, next) => {
    try {
        const { interval, outcome } = priceHistorySchema.parse(req.query);
        const CACHE_TTL = parseInt(process.env.CACHE_PRICE_HISTORY_TTL || "300");
        // Ambil market untuk dapatkan tokenId
        const market = await (0, market_service_1.getMarketDetail)(req.params.id);
        if (!market) {
            res.status(404).json({ error: "Market not found" });
            return;
        }
        const tokens = market.tokens || [];
        const token = tokens.find((t) => t.outcome === outcome) || tokens[0];
        if (!token) {
            res.json({ data: [], outcome, marketId: req.params.id });
            return;
        }
        const cacheKey = `price-history:${token.token_id}:${interval}`;
        const history = await cache_1.cache.getOrSet(cacheKey, () => (0, polymarket_service_1.fetchPriceHistory)(token.token_id, interval), CACHE_TTL);
        // Format untuk LineChart dari gifted-charts di Aurora app
        // price dari Polymarket: 0.0–1.0 → konversi ke 0–100 (persen)
        const formatted = history.map((point) => ({
            value: parseFloat((point.p * 100).toFixed(2)),
            timestamp: point.t,
            label: new Date(point.t * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            }),
        }));
        res.json({
            data: formatted,
            outcome,
            tokenId: token.token_id,
            interval,
            count: formatted.length,
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=markets.js.map