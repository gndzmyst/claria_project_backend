import axios from "axios";
import WebSocket from "ws";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Axios Clients
// ─────────────────────────────────────────────────────────────────────────────

export const gammaClient = axios.create({
  baseURL:
    process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com",
  timeout: 15000,
  headers: { Accept: "application/json" },
});

export const clobClient = axios.create({
  baseURL: process.env.POLYMARKET_CLOB_URL || "https://clob.polymarket.com",
  timeout: 15000,
  headers: { Accept: "application/json" },
});

export const dataClient = axios.create({
  baseURL: process.env.POLYMARKET_DATA_URL || "https://data-api.polymarket.com",
  timeout: 15000,
  headers: { Accept: "application/json" },
});

[gammaClient, clobClient, dataClient].forEach((client) => {
  client.interceptors.response.use(
    (res) => res,
    (err) => {
      // Log URL lengkap + response body untuk diagnosa 422
      const params = err.config?.params ?? {};
      const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join("&");
      logger.error(`Polymarket API error: ${err.message}`, {
        url: `${err.config?.baseURL ?? ""}${err.config?.url ?? ""}${qs ? `?${qs}` : ""}`,
        status: err.response?.status,
        body: JSON.stringify(err.response?.data ?? {}),
      });
      return Promise.reject(err);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
//
// Berdasarkan docs resmi GET /events:
// https://docs.polymarket.com/developers/gamma-markets-api/get-events
//
// ⚠️ GammaEvent (level event):
//   - volume: number
//   - volume24hr: number
//   - liquidity: number
//
// ⚠️ GammaEventMarket (level market, nested di event.markets[]):
//   - volume: string    ← anomali Polymarket, market level pakai string
//   - volume24hr: number
//   - liquidity: string ← anomali Polymarket, market level pakai string
//   - outcomes: string  ← selalu JSON string '["Yes","No"]'
//   - outcomePrices: string ← selalu JSON string '["0.65","0.35"]'
//   - clobTokenIds: string  ← selalu JSON string '["tokenA","tokenB"]'
// ─────────────────────────────────────────────────────────────────────────────

export interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

export interface GammaEventMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource?: string;
  endDate?: string;
  startDate?: string;
  image?: string;
  icon?: string;
  description?: string;
  outcomes: string; // JSON string: '["Yes","No"]'
  outcomePrices: string; // JSON string: '["0.65","0.35"]'
  volume: string; // string di market level (anomali API)
  volume24hr: number; // number di market level
  liquidity: string; // string di market level (anomali API)
  active: boolean;
  closed: boolean;
  archived?: boolean;
  new?: boolean;
  featured?: boolean;
  marketType?: string;
  clobTokenIds: string; // JSON string: '["tokenId1","tokenId2"]'
  tokens?: Array<{ token_id: string; outcome: string }>;
  tags?: GammaTag[];
  enableOrderBook?: boolean;
  spread?: number;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  competitive?: number;
  gameStartTime?: string;
  eventStartTime?: string;
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
  subcategory?: string;
  image?: string;
  icon?: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  featured: boolean;
  new: boolean;
  restricted?: boolean;
  volume: number; // number di event level
  volume24hr: number; // number di event level
  liquidity: number; // number di event level
  openInterest?: number;
  tags: GammaTag[];
  markets: GammaEventMarket[];
  startDate?: string;
  endDate?: string;
  creationDate?: string;
  sortBy?: string;
  competitive?: number;
  enableOrderBook?: boolean;
}

export interface AuroraMarket {
  id: string;
  polymarketId: string;
  slug: string;
  eventSlug: string;
  question: string;
  description: string | null;
  category: string;
  tags: string[];
  outcomes: string[];
  outcomePrices: Record<string, number>;
  tokens: Array<{ token_id: string; outcome: string }>;
  volume: number;
  volume24h: number;
  liquidity: number;
  spread: number | null;
  active: boolean;
  closed: boolean;
  featured: boolean;
  isNew: boolean;
  imageUrl: string | null;
  icon: string | null;
  endDate: Date | null;
  startDate: Date | null;
  eventId: string;
  lastSyncedAt: Date;
}

export interface ClobOrderBook {
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  hash: string;
  timestamp: string;
}

export interface ClobPricePoint {
  t: number;
  p: number;
}

export interface PolymarketPosition {
  market: string;
  asset: string;
  outcome: string;
  size: number;
  avg_price: number;
  current_price: number;
  value: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

export const POLYMARKET_TAG_IDS = {
  Politics: 2,
  Crypto: 21,
  Sports: 100639,
  Finance: 120,
  Tech: 1401,
  Culture: 596,
  Geopolitics: 100265,
} as const;

export async function fetchGammaEvents(params?: {
  limit?: number;
  offset?: number;
  closed?: boolean;
  tag_id?: number;
  exclude_tag_id?: number;
  related_tags?: boolean;
  order?: string;
  ascending?: boolean;
  featured?: boolean;
  slug?: string;
  id?: number;
  cyom?: boolean;
  start_date_min?: string;
  start_date_max?: string;
  end_date_min?: string;
  end_date_max?: string;
}): Promise<GammaEvent[]> {
  const reqParams: Record<string, unknown> = {
    limit: Math.min(params?.limit ?? 20, 100),
  };

  // Hanya kirim offset jika > 0 (menghindari param tidak perlu)
  if (params?.offset && params.offset > 0) {
    reqParams.offset = params.offset;
  }

  // closed=false → filter event yang masih terbuka
  // Pengganti "active=true" yang TIDAK VALID
  if (params?.closed !== undefined) {
    reqParams.closed = params.closed;
  }

  // order: nama field PERSIS dari response object (camelCase)
  // Hanya kirim jika diperlukan — default API sudah cukup baik
  if (params?.order) {
    reqParams.order = params.order;
  }

  // ascending: hanya kirim jika true (false adalah default, tidak perlu dikirim)
  if (params?.ascending === true) {
    reqParams.ascending = true;
  }

  if (params?.tag_id !== undefined) reqParams.tag_id = params.tag_id;
  if (params?.exclude_tag_id !== undefined)
    reqParams.exclude_tag_id = params.exclude_tag_id;
  if (params?.related_tags !== undefined)
    reqParams.related_tags = params.related_tags;
  if (params?.featured !== undefined) reqParams.featured = params.featured;
  if (params?.slug !== undefined) reqParams.slug = params.slug;
  if (params?.id !== undefined) reqParams.id = params.id;
  if (params?.cyom !== undefined) reqParams.cyom = params.cyom;
  if (params?.start_date_min) reqParams.start_date_min = params.start_date_min;
  if (params?.start_date_max) reqParams.start_date_max = params.start_date_max;
  if (params?.end_date_min) reqParams.end_date_min = params.end_date_min;
  if (params?.end_date_max) reqParams.end_date_max = params.end_date_max;

  logger.debug(`fetchGammaEvents params: ${JSON.stringify(reqParams)}`);

  const { data } = await gammaClient.get<GammaEvent[]>("/events", {
    params: reqParams,
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchGammaEventBySlug(
  slug: string,
): Promise<GammaEvent | null> {
  try {
    const { data } = await gammaClient.get<GammaEvent[]>("/events", {
      params: { slug },
    });
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export async function fetchGammaMarketByConditionId(
  conditionId: string,
): Promise<GammaEventMarket | null> {
  try {
    const { data } = await gammaClient.get<GammaEventMarket>(
      `/markets/${conditionId}`,
    );
    return data?.id ? data : null;
  } catch {
    return null;
  }
}

export async function fetchGammaMarketBySlug(
  slug: string,
): Promise<GammaEventMarket | null> {
  try {
    const { data } = await gammaClient.get<GammaEventMarket[]>("/markets", {
      params: { slug },
    });
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export async function fetchGammaSearch(
  term: string,
  limit: number = 20,
): Promise<GammaEvent[]> {
  try {
    const { data } = await gammaClient.get<GammaEvent[]>("/events", {
      params: {
        title_contains: term,
        limit: Math.min(limit, 100),
        closed: false,
      },
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.warn(`Search fetch failed: ${(err as Error).message}`);
    return [];
  }
}

export async function fetchClobPrice(tokenId: string): Promise<number | null> {
  try {
    const { data } = await clobClient.get<{ price: string }>(
      "/last-trade-price",
      {
        params: { token_id: tokenId },
      },
    );
    const price = parseFloat(data.price ?? "0");
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

export async function fetchClobMidpoint(
  tokenId: string,
): Promise<number | null> {
  try {
    const { data } = await clobClient.get<{ mid: string }>("/midpoint", {
      params: { token_id: tokenId },
    });
    const mid = parseFloat(data.mid ?? "0");
    return isNaN(mid) ? null : mid;
  } catch {
    return null;
  }
}

const WS_CLOB_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const WS_PING_INTERVAL_MS = 10_000;

export interface TokenPriceSnapshot {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  lastPrice: number;
  midpoint: number;
}

export function fetchTokenPricesViaWS(
  tokenIds: string[],
  timeoutMs = 8000,
): Promise<Map<string, TokenPriceSnapshot>> {
  return new Promise((resolve) => {
    if (tokenIds.length === 0) {
      resolve(new Map());
      return;
    }

    const prices = new Map<string, TokenPriceSnapshot>();
    let ws: WebSocket;
    let pingTimer: NodeJS.Timeout;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(pingTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(prices);
    };

    const timeout = setTimeout(finish, timeoutMs);

    try {
      ws = new WebSocket(WS_CLOB_URL);
    } catch (err) {
      logger.warn(`WS init failed: ${(err as Error).message}`);
      clearTimeout(timeout);
      resolve(new Map());
      return;
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ assets_ids: tokenIds, type: "market" }));
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("PING");
      }, WS_PING_INTERVAL_MS);
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        const eventType: string = msg.event_type;

        if (eventType === "book") {
          const assetId: string = msg.asset_id;
          if (!tokenIds.includes(assetId)) return;
          const bids: Array<{ price: string; size: string }> = msg.bids ?? [];
          const asks: Array<{ price: string; size: string }> = msg.asks ?? [];
          const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
          const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
          const midpoint =
            bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
          prices.set(assetId, {
            tokenId: assetId,
            bestBid,
            bestAsk,
            lastPrice: midpoint,
            midpoint,
          });
          if (prices.size >= tokenIds.length) finish();
        } else if (eventType === "price_change") {
          const changes: Array<{
            asset_id: string;
            best_bid: string;
            best_ask: string;
          }> = msg.price_changes ?? [];
          changes.forEach((change) => {
            const existing = prices.get(change.asset_id);
            if (!existing) return;
            const bestBid = parseFloat(change.best_bid ?? "0");
            const bestAsk = parseFloat(change.best_ask ?? "0");
            existing.bestBid = bestBid;
            existing.bestAsk = bestAsk;
            existing.midpoint = (bestBid + bestAsk) / 2;
          });
        } else if (eventType === "last_trade_price") {
          const existing = prices.get(msg.asset_id as string);
          if (existing) existing.lastPrice = parseFloat(msg.price ?? "0");
        }
      } catch {
        /* ignore parse errors */
      }
    });

    ws.on("error", (err) => {
      logger.warn(`WS error: ${err.message}`);
      finish();
    });

    ws.on("close", () => finish());
  });
}

export async function fetchOrderBook(tokenId: string): Promise<ClobOrderBook> {
  const { data } = await clobClient.get<ClobOrderBook>("/book", {
    params: { token_id: tokenId },
  });
  return data;
}

export async function fetchPriceHistory(
  tokenId: string,
  interval: "1m" | "1h" | "6h" | "1d" | "1w" | "all" = "1d",
): Promise<ClobPricePoint[]> {
  const fidelityMap: Record<string, number> = {
    "1m": 1,
    "1h": 60,
    "6h": 360,
    "1d": 60,
    "1w": 360,
    all: 1440,
  };
  const { data } = await clobClient.get<{ history: ClobPricePoint[] }>(
    "/prices-history",
    {
      params: {
        market: tokenId,
        interval,
        fidelity: fidelityMap[interval] ?? 60,
      },
    },
  );
  return data.history ?? [];
}

export async function fetchUserPositions(
  walletAddress: string,
): Promise<PolymarketPosition[]> {
  const { data } = await dataClient.get<PolymarketPosition[]>("/positions", {
    params: { user: walletAddress.toLowerCase() },
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchUserActivity(
  walletAddress: string,
  limit = 20,
): Promise<unknown[]> {
  const { data } = await dataClient.get("/activity", {
    params: { user: walletAddress.toLowerCase(), limit },
  });
  return Array.isArray(data) ? data : [];
}
