// ─────────────────────────────────────────────────────────────────────────────
// src/routes/markets.ts
// Aurora Backend — Markets Routes
//
// Category yang tersedia:
//   Static:  All, Politics, Crypto, Economy, Sports, Technology, Culture
//   Dynamic: Trending, Breaking, Ending Soon, Highest Volume, New
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getMarkets, getMarketDetail } from "../services/market.service";
import { cache } from "../utils/cache";
import { fetchPriceHistory } from "../services/polymarket.service";

const router = Router();

// Semua nilai category yang valid di Aurora
const VALID_CATEGORIES = [
  // Static (tag-based)
  "All",
  "Politics",
  "Crypto",
  "Economy",
  "Sports",
  "Technology",
  "Culture",
  // Dynamic (computed)
  "Trending",
  "Breaking",
  "EndingSoon",
  "HighestVolume",
  "New",
] as const;

type AuroraCategory = (typeof VALID_CATEGORIES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/markets
// Ambil daftar market dengan filter opsional
// Query: category, limit, offset, search
// ─────────────────────────────────────────────────────────────────────────────
const marketsQuerySchema = z.object({
  category: z.enum(VALID_CATEGORIES).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  search: z.string().min(1).max(200).optional(),
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
// GET /api/markets/categories
// Daftar semua category yang tersedia beserta deskripsinya
// ─────────────────────────────────────────────────────────────────────────────
router.get("/categories", (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: "All",
        label: "All Markets",
        description: "Semua market yang sedang aktif",
        type: "static",
        icon: "grid",
      },
      {
        id: "Trending",
        label: "Trending",
        description: "Market dengan volume & aktivitas tertinggi hari ini",
        type: "dynamic",
        icon: "trending-up",
      },
      {
        id: "Breaking",
        label: "Breaking",
        description:
          "Market yang mengalami pergerakan harga paling besar dalam 24 jam terakhir",
        type: "dynamic",
        icon: "zap",
      },
      {
        id: "EndingSoon",
        label: "Ending Soon",
        description: "Market yang akan berakhir dalam 24 jam ke depan",
        type: "dynamic",
        icon: "clock",
      },
      {
        id: "HighestVolume",
        label: "Highest Volume",
        description: "Market dengan total volume trading terbesar",
        type: "dynamic",
        icon: "bar-chart-2",
      },
      {
        id: "New",
        label: "New",
        description: "Market yang baru ditambahkan",
        type: "dynamic",
        icon: "star",
      },
      {
        id: "Politics",
        label: "Politics",
        description: "Pemilu, kebijakan pemerintah, geopolitik",
        type: "static",
        tagId: 2,
        icon: "landmark",
      },
      {
        id: "Crypto",
        label: "Crypto",
        description: "Bitcoin, Ethereum, DeFi, dan aset kripto lainnya",
        type: "static",
        tagId: 21,
        icon: "bitcoin",
      },
      {
        id: "Economy",
        label: "Economy",
        description: "Saham, forex, suku bunga, inflasi, ekonomi makro",
        type: "static",
        tagId: 120,
        icon: "dollar-sign",
      },
      {
        id: "Sports",
        label: "Sports",
        description: "NBA, NFL, sepak bola, UFC, F1, dan olahraga lainnya",
        type: "static",
        tagId: 100639,
        icon: "trophy",
      },
      {
        id: "Technology",
        label: "Technology",
        description: "AI, big tech, produk teknologi, startup",
        type: "static",
        tagId: 1401,
        icon: "cpu",
      },
      {
        id: "Culture",
        label: "Culture",
        description: "Pop culture, entertainment, selebriti, awards",
        type: "static",
        tagId: 596,
        icon: "film",
      },
    ],
  });
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
// Data harga historis untuk chart
// Query: interval (1m|1h|6h|1d|1w|all), outcome (Yes|No|nama lain)
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

      const market = await getMarketDetail(req.params.id as string);
      if (!market) {
        res.status(404).json({ error: "Market not found" });
        return;
      }

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

      // Format untuk LineChart — price 0.0–1.0 → 0–100%
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
