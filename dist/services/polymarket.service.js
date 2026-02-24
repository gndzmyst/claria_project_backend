"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataClient = exports.clobClient = exports.gammaClient = void 0;
exports.fetchGammaMarkets = fetchGammaMarkets;
exports.fetchGammaMarketById = fetchGammaMarketById;
exports.fetchGammaEvents = fetchGammaEvents;
exports.fetchOrderBook = fetchOrderBook;
exports.fetchPriceHistory = fetchPriceHistory;
exports.fetchLastTradePrice = fetchLastTradePrice;
exports.fetchUserPositions = fetchUserPositions;
exports.fetchUserActivity = fetchUserActivity;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
// ─────────────────────────────────────────────────────────────────────────────
// Axios Instances — satu per Polymarket API
// Semua API ini PUBLIC, tidak butuh API key
// ─────────────────────────────────────────────────────────────────────────────
exports.gammaClient = axios_1.default.create({
    baseURL: process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com",
    timeout: 15000,
    headers: { Accept: "application/json" },
});
exports.clobClient = axios_1.default.create({
    baseURL: process.env.POLYMARKET_CLOB_URL || "https://clob.polymarket.com",
    timeout: 15000,
    headers: { Accept: "application/json" },
});
exports.dataClient = axios_1.default.create({
    baseURL: process.env.POLYMARKET_DATA_URL || "https://data-api.polymarket.com",
    timeout: 15000,
    headers: { Accept: "application/json" },
});
// Log error dari semua Polymarket clients
[exports.gammaClient, exports.clobClient, exports.dataClient].forEach((client) => {
    client.interceptors.response.use((res) => res, (err) => {
        logger_1.logger.error(`Polymarket API error: ${err.message}`, {
            url: err.config?.url,
            status: err.response?.status,
        });
        return Promise.reject(err);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// GAMMA API — Market & Event Data
// Base URL: https://gamma-api.polymarket.com
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ambil daftar market aktif dari Polymarket
 */
async function fetchGammaMarkets(params) {
    const { data } = await exports.gammaClient.get("/markets", {
        params: {
            limit: params?.limit ?? 100,
            offset: params?.offset ?? 0,
            active: params?.active ?? true,
            closed: params?.closed ?? false,
            ...(params?.category && { category: params.category }),
            ...(params?.tag && { tag: params.tag }),
            ...(params?.order && { order: params.order }),
            ...(params?.ascending !== undefined && { ascending: params.ascending }),
        },
    });
    return Array.isArray(data) ? data : [];
}
/**
 * Ambil detail satu market berdasarkan conditionId
 */
async function fetchGammaMarketById(conditionId) {
    const { data } = await exports.gammaClient.get(`/markets/${conditionId}`);
    return data;
}
/**
 * Ambil daftar events dari Polymarket
 */
async function fetchGammaEvents(params) {
    const { data } = await exports.gammaClient.get("/events", {
        params: {
            limit: params?.limit ?? 50,
            offset: params?.offset ?? 0,
            active: params?.active ?? true,
            ...(params?.category && { category: params.category }),
        },
    });
    return Array.isArray(data) ? data : [];
}
// ─────────────────────────────────────────────────────────────────────────────
// CLOB API — Order Book & Price History
// Base URL: https://clob.polymarket.com
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ambil order book real-time untuk satu token
 * @param tokenId - dari market.tokens[].token_id
 */
async function fetchOrderBook(tokenId) {
    const { data } = await exports.clobClient.get("/book", {
        params: { token_id: tokenId },
    });
    return data;
}
/**
 * Ambil price history untuk chart
 * @param tokenId - dari market.tokens[].token_id
 * @param interval - resolusi data
 */
async function fetchPriceHistory(tokenId, interval = "1d") {
    const fidelityMap = {
        "1m": 1,
        "1h": 60,
        "6h": 360,
        "1d": 60,
        "1w": 360,
        all: 1440,
    };
    const { data } = await exports.clobClient.get("/prices-history", {
        params: {
            market: tokenId,
            interval,
            fidelity: fidelityMap[interval] ?? 60,
        },
    });
    return data.history ?? [];
}
/**
 * Ambil harga terakhir untuk satu token
 */
async function fetchLastTradePrice(tokenId) {
    const { data } = await exports.clobClient.get("/last-trade-price", {
        params: { token_id: tokenId },
    });
    return parseFloat(data.price ?? "0");
}
// ─────────────────────────────────────────────────────────────────────────────
// DATA API — User Positions & Activity
// Base URL: https://data-api.polymarket.com
// Butuh wallet address Polygon milik user
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ambil posisi trading user dari Polymarket (real, bukan simulasi)
 * Hanya tersedia jika user sudah connect wallet dan pernah trading di Polymarket
 */
async function fetchUserPositions(walletAddress) {
    const { data } = await exports.dataClient.get("/positions", {
        params: { user: walletAddress.toLowerCase() },
    });
    return Array.isArray(data) ? data : [];
}
/**
 * Ambil histori aktivitas user dari Polymarket
 */
async function fetchUserActivity(walletAddress, limit = 20) {
    const { data } = await exports.dataClient.get("/activity", {
        params: { user: walletAddress.toLowerCase(), limit },
    });
    return Array.isArray(data) ? data : [];
}
//# sourceMappingURL=polymarket.service.js.map