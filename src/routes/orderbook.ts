import { Router, Request, Response, NextFunction } from "express";
import { cache } from "../utils/cache";
import { fetchOrderBook } from "../services/polymarket.service";
import { getMarketDetail } from "../services/market.service";

const router = Router();

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
router.get(
  "/:marketId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const CACHE_TTL = parseInt(process.env.CACHE_ORDERBOOK_TTL || "5");

      const market = await getMarketDetail(req.params.marketId as string);
      if (!market) {
        res.status(404).json({ error: "Market not found" });
        return;
      }

      type TokenEntry = { token_id: string; outcome: string };
      const tokens = (market as { tokens?: TokenEntry[] }).tokens || [];

      if (tokens.length === 0) {
        res.status(404).json({ error: "Market has no tokens" });
        return;
      }

      // Fetch order book untuk semua token (Yes, No) secara paralel
      const results = await Promise.allSettled(
        tokens.map(async (token: TokenEntry) => {
          const cacheKey = `orderbook:${token.token_id}`;
          const book = await cache.getOrSet(
            cacheKey,
            () => fetchOrderBook(token.token_id),
            CACHE_TTL,
          );
          return { outcome: token.outcome, tokenId: token.token_id, book };
        }),
      );

      // Susun response per outcome
      const orderbook: Record<
        string,
        {
          tokenId: string;
          bids: Array<{ price: number; size: number }>;
          asks: Array<{ price: number; size: number }>;
          timestamp: string;
        }
      > = {};

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
    } catch (err) {
      next(err);
    }
  },
);

export default router;
