import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getMarkets, getMarketDetail } from "../services/market.service";
import { cache } from "../utils/cache";
import { fetchPriceHistory } from "../services/polymarket.service";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets
// Ambil daftar market dengan filter opsional
// Query: category, limit, offset, search
// ─────────────────────────────────────────────────────────────────────────────
const marketsQuerySchema = z.object({
  category: z
    .enum(["Trending", "New", "Politics", "Sports", "Crypto"])
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  search: z.string().min(1).max(100).optional(),
});

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = marketsQuerySchema.parse(req.query);
    const markets = await getMarkets(query);
    res.json({ data: markets, total: markets.length });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets/:id
// Detail satu market — id bisa berupa conditionId, polymarketId, atau slug
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const market = await getMarketDetail(req.params.id as string);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    res.json({ data: market });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets/:id/price-history
// Data harga historis untuk chart di Aurora app
// Query: interval (1m|1h|6h|1d|1w|all), outcome (Yes|No|nama lain)
// Response format sesuai LineChart dari gifted-charts: [{value, label, timestamp}]
// ─────────────────────────────────────────────────────────────────────────────
const priceHistorySchema = z.object({
  interval: z.enum(["1m", "1h", "6h", "1d", "1w", "all"]).default("1d"),
  outcome: z.string().default("Yes"),
});

router.get(
  "/:id/price-history",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { interval, outcome } = priceHistorySchema.parse(req.query);
      const CACHE_TTL = parseInt(process.env.CACHE_PRICE_HISTORY_TTL || "300");

      // Ambil market untuk dapatkan tokenId
      const market = await getMarketDetail(req.params.id as string);
      if (!market) {
        res.status(404).json({ error: "Market not found" });
        return;
      }

      // Ambil tokenId berdasarkan outcome yang diminta
      type TokenEntry = { token_id: string; outcome: string };
      const tokens = (market as { tokens?: TokenEntry[] }).tokens || [];
      const token =
        tokens.find((t: TokenEntry) => t.outcome === outcome) || tokens[0];

      if (!token) {
        res.json({ data: [], outcome, marketId: req.params.id });
        return;
      }

      const cacheKey = `price-history:${token.token_id}:${interval}`;
      const history = await cache.getOrSet(
        cacheKey,
        () =>
          fetchPriceHistory(
            token.token_id,
            interval as "1m" | "1h" | "6h" | "1d" | "1w" | "all",
          ),
        CACHE_TTL,
      );

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
    } catch (err) {
      next(err);
    }
  },
);

export default router;
