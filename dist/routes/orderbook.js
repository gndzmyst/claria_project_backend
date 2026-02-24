"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const cache_1 = require("../utils/cache");
const polymarket_service_1 = require("../services/polymarket.service");
const market_service_1 = require("../services/market.service");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orderbook/:marketId
// Ambil order book (bids & asks) untuk semua outcome dalam sebuah market
// Data di-cache 5 detik (real-time tapi tidak banjir request ke Polymarket)
//
// Response:
// {
//   data: {
//     "Yes": { bids: [{price, size}], asks: [{price, size}], timestamp },
//     "No":  { bids: [{price, size}], asks: [{price, size}], timestamp }
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:marketId", async (req, res, next) => {
    try {
        const CACHE_TTL = parseInt(process.env.CACHE_ORDERBOOK_TTL || "5");
        const market = await (0, market_service_1.getMarketDetail)(req.params.marketId);
        if (!market) {
            res.status(404).json({ error: "Market not found" });
            return;
        }
        const tokens = market.tokens || [];
        if (tokens.length === 0) {
            res.status(404).json({ error: "Market has no tokens" });
            return;
        }
        // Fetch order book untuk semua token (Yes, No) secara paralel
        const results = await Promise.allSettled(tokens.map(async (token) => {
            const cacheKey = `orderbook:${token.token_id}`;
            const book = await cache_1.cache.getOrSet(cacheKey, () => (0, polymarket_service_1.fetchOrderBook)(token.token_id), CACHE_TTL);
            return { outcome: token.outcome, tokenId: token.token_id, book };
        }));
        // Susun response per outcome
        const orderbook = {};
        results.forEach((result) => {
            if (result.status === "fulfilled") {
                const { outcome, tokenId, book } = result.value;
                orderbook[outcome] = {
                    tokenId,
                    bids: book.bids.slice(0, 15).map((b) => ({
                        price: parseFloat(b.price),
                        size: parseFloat(b.size),
                    })),
                    asks: book.asks.slice(0, 15).map((a) => ({
                        price: parseFloat(a.price),
                        size: parseFloat(a.size),
                    })),
                    timestamp: book.timestamp,
                };
            }
        });
        res.json({
            data: orderbook,
            marketId: req.params.marketId,
            outcomes: Object.keys(orderbook),
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=orderbook.js.map