// ─────────────────────────────────────────────────────────────────────────────
// src/services/market.service.ts
// Aurora Backend — Market Business Logic
//
// Category mapping ke Polymarket Tag IDs:
//   All          → no tag filter (semua)
//   Politics     → tag_id: 2
//   Crypto       → tag_id: 21
//   Economy      → tag_id: 120  (Finance/Economy)
//   Sports       → tag_id: 100639
//   Technology   → tag_id: 1401
//   Culture      → tag_id: 596
//
// Dynamic categories (tidak ada tag_id, dicompute dari data):
//   Trending     → default sort API (sudah trending/volume)
//   Breaking     → pergerakan harga terbesar 24 jam (competitive score / volume24h spike)
//   EndingSoon   → endDate dalam 24–48 jam ke depan
//   HighestVolume→ sort by volume total descending
//   New          → event.new === true atau baru dibuat
// ─────────────────────────────────────────────────────────────────────────────

import prisma from "../utils/prisma";
import { cache } from "../utils/cache";
import { logger } from "../utils/logger";
import {
  fetchGammaEvents,
  fetchGammaEventBySlug,
  fetchGammaMarketByConditionId,
  fetchGammaMarketBySlug,
  fetchGammaSearch,
  fetchEndingSoonEvents,
  fetchTokenPricesViaWS,
  POLYMARKET_TAG_IDS,
  type GammaEvent,
  type GammaEventMarket,
  type AuroraMarket,
} from "./polymarket.service";

const CACHE_TTL = parseInt(process.env.CACHE_MARKETS_TTL || "60");

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY → TAG_ID MAP
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_TAG_MAP: Record<string, number | undefined> = {
  All: undefined,
  Trending: undefined,
  Breaking: undefined,
  EndingSoon: undefined,
  HighestVolume: undefined,
  New: undefined,
  Politics: POLYMARKET_TAG_IDS.Politics, // 2
  Crypto: POLYMARKET_TAG_IDS.Crypto, // 21
  Economy: POLYMARKET_TAG_IDS.Economy, // 120
  Sports: POLYMARKET_TAG_IDS.Sports, // 100639
  Technology: POLYMARKET_TAG_IDS.Technology, // 1401
  Culture: POLYMARKET_TAG_IDS.Culture, // 596
};

const BLACKLIST_TAGS = ["Recurring", "Hide From New"];
const MIN_REMAINING_MS = 60 * 60 * 1000; // 1 jam

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parseJsonArray
// ─────────────────────────────────────────────────────────────────────────────
function parseJsonArray<T>(raw: string | T[] | undefined | null): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: safeFloat
// ─────────────────────────────────────────────────────────────────────────────
function safeFloat(val: string | number | undefined | null): number {
  if (val === undefined || val === null) return 0;
  const n = typeof val === "number" ? val : parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: buildOutcomePrices
// ─────────────────────────────────────────────────────────────────────────────
function buildOutcomePrices(
  outcomesRaw: string,
  pricesRaw: string,
): Record<string, number> {
  const outcomes = parseJsonArray<string>(outcomesRaw);
  const prices = parseJsonArray<string>(pricesRaw);
  const result: Record<string, number> = {};
  outcomes.forEach((outcome, i) => {
    result[outcome] = safeFloat(prices[i]);
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: buildTokens
// ─────────────────────────────────────────────────────────────────────────────
function buildTokens(
  clobTokenIdsRaw: string,
  outcomesRaw: string,
): Array<{ token_id: string; outcome: string }> {
  const tokenIds = parseJsonArray<string>(clobTokenIdsRaw);
  const outcomes = parseJsonArray<string>(outcomesRaw);
  return tokenIds.map((token_id, i) => ({
    token_id,
    outcome: outcomes[i] ?? (i === 0 ? "Yes" : "No"),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: mapTagsToCategory
// Mapping tag labels ke Aurora category
// ─────────────────────────────────────────────────────────────────────────────
function mapTagsToCategory(tags: string[], rawCategory?: string): string {
  const allText = [...tags, rawCategory ?? ""].join(" ").toLowerCase();

  if (
    allText.includes("crypto") ||
    allText.includes("bitcoin") ||
    allText.includes("ethereum") ||
    allText.includes("defi") ||
    allText.includes("blockchain") ||
    allText.includes("nft") ||
    allText.includes("btc") ||
    allText.includes("eth") ||
    allText.includes("solana") ||
    allText.includes("xrp") ||
    allText.includes("doge") ||
    allText.includes("bnb") ||
    allText.includes("altcoin")
  )
    return "Crypto";

  if (
    allText.includes("politics") ||
    allText.includes("elections") ||
    allText.includes("government") ||
    allText.includes("trump") ||
    allText.includes("president") ||
    allText.includes("congress") ||
    allText.includes("senate") ||
    allText.includes("geopolit") ||
    allText.includes("war") ||
    allText.includes("iran") ||
    allText.includes("russia") ||
    allText.includes("nato") ||
    allText.includes("tariff") ||
    allText.includes("sanction") ||
    allText.includes("military") ||
    allText.includes("ceasefire") ||
    allText.includes("election") ||
    allText.includes("vote") ||
    allText.includes("democrat") ||
    allText.includes("republican")
  )
    return "Politics";

  if (
    allText.includes("sports") ||
    allText.includes("nba") ||
    allText.includes("nfl") ||
    allText.includes("nhl") ||
    allText.includes("mlb") ||
    allText.includes("soccer") ||
    allText.includes("football") ||
    allText.includes("tennis") ||
    allText.includes("ufc") ||
    allText.includes("mma") ||
    allText.includes("golf") ||
    allText.includes("esports") ||
    allText.includes("dota 2") ||
    allText.includes("formula 1") ||
    allText.includes("formula e") ||
    allText.includes("f1 ") ||
    allText.includes("premier league") ||
    allText.includes("champions league") ||
    allText.includes("ncaa") ||
    allText.includes("wnba") ||
    allText.includes("serie a") ||
    allText.includes("bundesliga") ||
    allText.includes("la liga") ||
    allText.includes("ligue 1") ||
    allText.includes("baseball") ||
    allText.includes("basketball") ||
    allText.includes("cricket") ||
    allText.includes("rugby")
  )
    return "Sports";

  if (
    allText.includes("economy") ||
    allText.includes("economic") ||
    allText.includes("finance") ||
    allText.includes("financial") ||
    allText.includes("stock") ||
    allText.includes("fed rate") ||
    allText.includes("interest rate") ||
    allText.includes("inflation") ||
    allText.includes("gdp") ||
    allText.includes("recession") ||
    allText.includes("forex") ||
    allText.includes("bond") ||
    allText.includes("treasury") ||
    allText.includes("ipo") ||
    allText.includes("s&p") ||
    allText.includes("nasdaq") ||
    allText.includes("dow jones") ||
    allText.includes("federal reserve") ||
    allText.includes("unemployment") ||
    allText.includes("trade war") ||
    allText.includes("tariff")
  )
    return "Economy";

  if (
    allText.includes("technology") ||
    allText.includes("tech") ||
    allText.includes("ai ") ||
    allText.includes("artificial intelligence") ||
    allText.includes("openai") ||
    allText.includes("chatgpt") ||
    allText.includes("apple") ||
    allText.includes("google") ||
    allText.includes("microsoft") ||
    allText.includes("meta ") ||
    allText.includes("tesla") ||
    allText.includes("nvidia") ||
    allText.includes("startup") ||
    allText.includes("software") ||
    allText.includes("hardware") ||
    allText.includes("chip") ||
    allText.includes("semiconductor")
  )
    return "Technology";

  if (
    allText.includes("culture") ||
    allText.includes("entertainment") ||
    allText.includes("celebrity") ||
    allText.includes("movie") ||
    allText.includes("music") ||
    allText.includes("award") ||
    allText.includes("oscar") ||
    allText.includes("grammy") ||
    allText.includes("tv show") ||
    allText.includes("netflix") ||
    allText.includes("pop culture") ||
    allText.includes("viral") ||
    allText.includes("meme") ||
    allText.includes("game show") ||
    allText.includes("reality tv")
  )
    return "Culture";

  return "Trending";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: isRecurringMarket
// Hapus market yang berulang setiap 5 menit / 1 jam (noise)
// ─────────────────────────────────────────────────────────────────────────────
function isRecurringMarket(
  market: GammaEventMarket,
  tagLabels: string[],
): boolean {
  if (tagLabels.some((tag) => BLACKLIST_TAGS.includes(tag))) return true;
  const slug = (market.slug || "").toLowerCase();
  return [
    /[-_]5m[-_\d]/,
    /[-_]15m[-_\d]/,
    /[-_]1h[-_\d]/,
    /[-_]6h[-_\d]/,
    /updown-\d+m/,
    /up-or-down.*\d+[mh]-/,
  ].some((p) => p.test(slug));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: shouldShowMarket
// ─────────────────────────────────────────────────────────────────────────────
function shouldShowMarket(
  market: GammaEventMarket,
  category: string,
  now: Date,
): boolean {
  const volume = safeFloat(market.volume);
  const volume24h = safeFloat(market.volume24hr);
  const liquidity = safeFloat(market.liquidity);

  if (market.endDate) {
    const remaining = new Date(market.endDate).getTime() - now.getTime();
    if (remaining > 0 && remaining < MIN_REMAINING_MS) return false;
  }

  if (category === "Sports") {
    if (volume === 0 && volume24h === 0 && liquidity < 10) return false;
    if (
      (market.question || "").toLowerCase().startsWith("spread:") &&
      liquidity < 10
    )
      return false;
  }

  if (category === "Trending" || category === "All") {
    if (volume === 0 && volume24h === 0 && liquidity === 0) return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: transformEventMarket
// ─────────────────────────────────────────────────────────────────────────────
function transformEventMarket(
  market: GammaEventMarket,
  event: GammaEvent,
): AuroraMarket {
  const outcomePrices = buildOutcomePrices(
    market.outcomes,
    market.outcomePrices,
  );
  const tokens = buildTokens(market.clobTokenIds, market.outcomes);
  const priceValues = Object.values(outcomePrices);
  const spread =
    priceValues.length >= 2
      ? parseFloat(Math.abs(priceValues[0] - priceValues[1]).toFixed(6))
      : null;

  const eventTagLabels = (event.tags ?? []).map((t) => t.label ?? t.slug ?? "");
  const marketTagLabels = (market.tags ?? []).map(
    (t) => t.label ?? t.slug ?? "",
  );
  const allTagLabels = [...new Set([...eventTagLabels, ...marketTagLabels])];

  return {
    id: market.conditionId || market.id,
    polymarketId: market.id,
    slug: market.slug || market.id,
    eventSlug: event.slug,
    question: market.question || "Unknown Market",
    description: market.description || null,
    category: mapTagsToCategory(allTagLabels, event.category),
    tags: allTagLabels,
    outcomes: parseJsonArray<string>(market.outcomes),
    outcomePrices,
    tokens,
    volume: safeFloat(market.volume) || safeFloat(event.volume),
    volume24h: safeFloat(market.volume24hr) || safeFloat(event.volume24hr),
    liquidity: safeFloat(market.liquidity) || safeFloat(event.liquidity),
    spread,
    active: market.active ?? true,
    closed: market.closed ?? false,
    featured: event.featured ?? false,
    isNew: event.new ?? false,
    imageUrl: market.image || event.image || null,
    icon: market.icon || event.icon || null,
    endDate: market.endDate ? new Date(market.endDate) : null,
    startDate: market.startDate ? new Date(market.startDate) : null,
    eventId: event.id,
    lastSyncedAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: enrichWithRealPrices
// Enrich market prices via CLOB WebSocket untuk akurasi real-time
// ─────────────────────────────────────────────────────────────────────────────
async function enrichWithRealPrices(
  markets: AuroraMarket[],
): Promise<AuroraMarket[]> {
  const tokenIds: string[] = [];
  markets.forEach((market) => {
    market.tokens.forEach((token) => {
      if (token.token_id && token.token_id.length > 10)
        tokenIds.push(token.token_id);
    });
  });

  if (tokenIds.length === 0) return markets;

  logger.debug(`Enriching ${tokenIds.length} tokens via CLOB WebSocket...`);

  try {
    const priceMap = await fetchTokenPricesViaWS(tokenIds, 8000);
    if (priceMap.size === 0) {
      logger.debug("WS returned no prices, using Gamma prices");
      return markets;
    }

    markets.forEach((market) => {
      let updated = false;
      const newPrices = { ...market.outcomePrices };
      market.tokens.forEach((token) => {
        const snap = priceMap.get(token.token_id);
        if (!snap) return;
        const spreadVal = snap.bestAsk - snap.bestBid;
        const displayPrice = spreadVal < 0.02 ? snap.midpoint : snap.lastPrice;
        if (displayPrice > 0) {
          newPrices[token.outcome] = parseFloat(displayPrice.toFixed(4));
          updated = true;
        }
      });
      if (updated) {
        market.outcomePrices = newPrices;
        const vals = Object.values(newPrices);
        market.spread =
          vals.length >= 2
            ? parseFloat(Math.abs(vals[0] - vals[1]).toFixed(6))
            : null;
      }
    });

    logger.debug(`WS enriched prices for ${priceMap.size} tokens`);
  } catch (err) {
    logger.warn(
      `WS price enrichment failed, using Gamma prices: ${(err as Error).message}`,
    );
  }

  return markets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: processEvents
// Process array of GammaEvent → filter → transform → AuroraMarket[]
// ─────────────────────────────────────────────────────────────────────────────
function processEvents(
  events: GammaEvent[],
  category: string,
  now: Date,
  seenIds?: Set<string>,
): AuroraMarket[] {
  const markets: AuroraMarket[] = [];
  const ids = seenIds ?? new Set<string>();

  events.forEach((event) => {
    if (!event.markets || event.markets.length === 0) return;
    if (event.closed || event.archived) return;

    event.markets.forEach((market) => {
      if (!market.active || market.closed) return;

      const eventTagLabels = (event.tags ?? []).map(
        (t) => t.label ?? t.slug ?? "",
      );
      const marketTagLabels = (market.tags ?? []).map(
        (t) => t.label ?? t.slug ?? "",
      );
      const tagLabels = [...new Set([...eventTagLabels, ...marketTagLabels])];

      if (isRecurringMarket(market, tagLabels)) return;

      // Sports: skip yang sudah expired
      if (category === "Sports" && market.endDate) {
        if (new Date(market.endDate) < now) return;
      }

      // Skip expired + zero volume
      const endDate = market.endDate ? new Date(market.endDate) : null;
      if (endDate && endDate < now && safeFloat(market.volume24hr) === 0)
        return;

      if (!shouldShowMarket(market, category, now)) return;

      const transformed = transformEventMarket(market, event);
      if (!ids.has(transformed.id)) {
        ids.add(transformed.id);
        markets.push(transformed);
      }
    });
  });

  return markets;
}

// ─────────────────────────────────────────────────────────────────────────────
// getMarkets
// Main entry point untuk fetch market berdasarkan category
// ─────────────────────────────────────────────────────────────────────────────
export async function getMarkets(params?: {
  category?: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<AuroraMarket[]> {
  const cacheKey = `markets:${JSON.stringify(params || {})}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      const limit = params?.limit ?? 20;
      const offset = params?.offset ?? 0;
      const category = params?.category ?? "Trending";

      let events: GammaEvent[];
      const now = new Date();

      // ── Search ─────────────────────────────────────────────────────────────
      if (params?.search) {
        events = await fetchGammaSearch(params.search, 50);
        const markets = processEvents(events, "All", now);
        return enrichWithRealPrices(markets.slice(offset, offset + limit));
      }

      // ── Breaking ───────────────────────────────────────────────────────────
      // Market yang mengalami pergerakan/aktivitas terbesar 24 jam terakhir
      // Implementasi: sort by volume24h DESC + competitive score
      if (category === "Breaking") {
        events = await fetchGammaEvents({
          limit: 100,
          closed: false,
          // Tidak ada order param — filter client-side by volume24h spike
        });
        const allMarkets = processEvents(events, "Breaking", now);
        // Sort by volume24h DESC — pasar dengan aktivitas terbesar = "breaking"
        const sorted = allMarkets
          .filter((m) => m.volume24h > 0)
          .sort((a, b) => b.volume24h - a.volume24h);
        return enrichWithRealPrices(sorted.slice(offset, offset + limit));
      }

      // ── Ending Soon ────────────────────────────────────────────────────────
      // Market yang berakhir dalam 48 jam ke depan, sort by endDate ASC
      if (category === "EndingSoon") {
        // Coba API-level filter dulu
        let endingSoonEvents = await fetchEndingSoonEvents(48, 100);

        // Fallback: fetch general dan filter client-side
        if (endingSoonEvents.length < 5) {
          const fallback = await fetchGammaEvents({
            limit: 100,
            closed: false,
          });
          endingSoonEvents = [...endingSoonEvents, ...fallback];
        }

        const allMarkets = processEvents(endingSoonEvents, "EndingSoon", now);
        const deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        const filtered = allMarkets
          .filter((m) => {
            if (!m.endDate) return false;
            return m.endDate > now && m.endDate <= deadline;
          })
          .sort((a, b) => {
            if (!a.endDate || !b.endDate) return 0;
            return a.endDate.getTime() - b.endDate.getTime(); // terkecil dulu
          });

        return enrichWithRealPrices(filtered.slice(offset, offset + limit));
      }

      // ── Highest Volume ─────────────────────────────────────────────────────
      // Market dengan total trading volume terbesar sepanjang waktu
      if (category === "HighestVolume") {
        events = await fetchGammaEvents({
          limit: 100,
          closed: false,
          // Default API tidak ada order yang eksak untuk volume
          // sort client-side lebih reliable
        });
        const allMarkets = processEvents(events, "HighestVolume", now);
        const sorted = allMarkets.sort((a, b) => b.volume - a.volume);
        return enrichWithRealPrices(sorted.slice(offset, offset + limit));
      }

      // ── New ────────────────────────────────────────────────────────────────
      if (category === "New") {
        events = await fetchGammaEvents({
          limit: Math.min(limit + offset + 40, 100),
          closed: false,
        });
        const newEvents = events.filter((e) => e.new === true);
        const sourceEvents = newEvents.length >= limit ? newEvents : events;
        const allMarkets = processEvents(sourceEvents, "New", now);
        const filtered = allMarkets.filter((m) => m.isNew);
        const final = filtered.length >= limit ? filtered : allMarkets;
        return enrichWithRealPrices(final.slice(offset, offset + limit));
      }

      // ── Sports ─────────────────────────────────────────────────────────────
      if (category === "Sports") {
        events = await fetchGammaEvents({
          limit: Math.min(limit + offset + 60, 100),
          closed: false,
          tag_id: CATEGORY_TAG_MAP.Sports,
          order: "startDate",
          // ascending tidak dikirim (false = descending = terbaru dulu)
        });
        const allMarkets = processEvents(events, "Sports", now);
        return enrichWithRealPrices(allMarkets.slice(offset, offset + limit));
      }

      // ── Trending ───────────────────────────────────────────────────────────
      if (category === "Trending") {
        events = await fetchGammaEvents({
          limit: Math.min((limit + offset) * 2, 100),
          closed: false,
          // Default Polymarket API sudah sort by trending/volume
        });
        const allMarkets = processEvents(events, "Trending", now);
        return enrichWithRealPrices(allMarkets.slice(offset, offset + limit));
      }

      // ── All ────────────────────────────────────────────────────────────────
      if (category === "All") {
        events = await fetchGammaEvents({
          limit: Math.min((limit + offset) * 2, 100),
          closed: false,
        });
        const allMarkets = processEvents(events, "All", now);
        return enrichWithRealPrices(allMarkets.slice(offset, offset + limit));
      }

      // ── Static categories (Politics, Crypto, Economy, Technology, Culture) ─
      const tagId = CATEGORY_TAG_MAP[category];
      events = await fetchGammaEvents({
        limit: Math.min((limit + offset) * 2, 100),
        closed: false,
        tag_id: tagId,
        related_tags: true, // include related tags untuk coverage lebih luas
        // Default sort API
      });
      const allMarkets = processEvents(events, category, now);
      return enrichWithRealPrices(allMarkets.slice(offset, offset + limit));
    },
    CACHE_TTL,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// getMarketDetail
// Cari detail satu market — fallback chain:
//   1. Event slug → 2. Condition ID → 3. Market slug → 4. DB
// ─────────────────────────────────────────────────────────────────────────────
export async function getMarketDetail(
  idOrSlug: string,
): Promise<AuroraMarket | null> {
  const cacheKey = `market:${idOrSlug}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      // 1. Coba via event slug
      const event = await fetchGammaEventBySlug(idOrSlug);
      if (event && event.markets?.length > 0) {
        const result = transformEventMarket(event.markets[0], event);
        const enriched = await enrichWithRealPrices([result]);
        return enriched[0] ?? null;
      }

      // 2. Coba via condition ID
      const marketById = await fetchGammaMarketByConditionId(idOrSlug);
      if (marketById?.id) {
        const dummyEvent: GammaEvent = {
          id: marketById.id,
          slug: idOrSlug,
          title: marketById.question,
          active: marketById.active,
          closed: marketById.closed,
          featured: false,
          new: false,
          volume: 0,
          volume24hr: 0,
          liquidity: 0,
          tags: [],
          markets: [marketById],
        };
        const result = transformEventMarket(marketById, dummyEvent);
        const enriched = await enrichWithRealPrices([result]);
        return enriched[0] ?? null;
      }

      // 3. Coba via market slug
      const marketBySlug = await fetchGammaMarketBySlug(idOrSlug);
      if (marketBySlug?.id) {
        const dummyEvent: GammaEvent = {
          id: marketBySlug.id,
          slug: idOrSlug,
          title: marketBySlug.question,
          active: marketBySlug.active,
          closed: marketBySlug.closed,
          featured: false,
          new: false,
          volume: 0,
          volume24hr: 0,
          liquidity: 0,
          tags: [],
          markets: [marketBySlug],
        };
        const result = transformEventMarket(marketBySlug, dummyEvent);
        const enriched = await enrichWithRealPrices([result]);
        return enriched[0] ?? null;
      }

      // 4. Last resort: DB
      logger.info(`Last resort — checking DB for: ${idOrSlug}`);
      const dbMarket = await prisma.market.findFirst({
        where: {
          OR: [
            { id: idOrSlug },
            { slug: idOrSlug },
            { polymarketId: idOrSlug },
          ],
        },
      });
      return (dbMarket as unknown as AuroraMarket) ?? null;
    },
    CACHE_TTL,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// syncMarketsFromPolymarket
// Sync semua category ke DB — dijalankan oleh cron job
// ─────────────────────────────────────────────────────────────────────────────
export async function syncMarketsFromPolymarket(): Promise<{
  count: number;
  duration: number;
}> {
  const startTime = Date.now();
  let count = 0;

  try {
    logger.info("⏳ Syncing markets to DB via /events endpoint...");

    const allMarkets: AuroraMarket[] = [];
    const seenIds = new Set<string>();

    const syncCategoryConfig = [
      { name: "Trending", tagId: undefined as number | undefined },
      { name: "Politics", tagId: POLYMARKET_TAG_IDS.Politics },
      { name: "Crypto", tagId: POLYMARKET_TAG_IDS.Crypto },
      { name: "Economy", tagId: POLYMARKET_TAG_IDS.Economy },
      { name: "Sports", tagId: POLYMARKET_TAG_IDS.Sports },
      { name: "Technology", tagId: POLYMARKET_TAG_IDS.Technology },
      { name: "Culture", tagId: POLYMARKET_TAG_IDS.Culture },
    ];

    for (const cat of syncCategoryConfig) {
      try {
        const events = await fetchGammaEvents({
          limit: 100,
          closed: false,
          ...(cat.tagId !== undefined && { tag_id: cat.tagId }),
        });

        events.forEach((event) => {
          if (event.closed || event.archived) return;
          const tagLabels = (event.tags ?? []).map(
            (t) => t.label ?? t.slug ?? "",
          );
          event.markets?.forEach((m) => {
            if (!m.active || m.closed) return;
            if (isRecurringMarket(m, tagLabels)) return;
            const market = transformEventMarket(m, event);
            if (!seenIds.has(market.id)) {
              seenIds.add(market.id);
              allMarkets.push(market);
            }
          });
        });

        logger.debug(`${cat.name} sync: fetched events`);
      } catch (err) {
        logger.warn(`Failed ${cat.name} fetch: ${(err as Error).message}`);
      }
    }

    logger.info(`Processing ${allMarkets.length} unique markets...`);

    // Step 1: Upsert Events (FK constraint)
    const uniqueEvents = new Map<string, AuroraMarket>();
    allMarkets.forEach((m) => {
      if (m.eventId && !uniqueEvents.has(m.eventId))
        uniqueEvents.set(m.eventId, m);
    });

    await Promise.allSettled(
      Array.from(uniqueEvents.values()).map((m) =>
        prisma.event.upsert({
          where: { id: m.eventId! },
          create: {
            id: m.eventId!,
            slug: m.eventSlug || m.eventId!,
            title: m.question,
            description: m.description,
            category: m.category,
            imageUrl: m.imageUrl,
            startDate: m.startDate,
            endDate: m.endDate,
            active: m.active,
            closed: m.closed,
          },
          update: { active: m.active, closed: m.closed },
        }),
      ),
    );
    logger.debug(`Upserted ${uniqueEvents.size} events to DB`);

    // Step 2: Upsert Markets
    const results = await Promise.allSettled(
      allMarkets.map(async (d) => {
        const updateData = {
          question: d.question,
          category: d.category,
          tags: d.tags,
          outcomePrices: d.outcomePrices,
          tokens: d.tokens,
          volume: d.volume,
          volume24h: d.volume24h,
          liquidity: d.liquidity,
          spread: d.spread,
          active: d.active,
          closed: d.closed,
          featured: d.featured,
          isNew: d.isNew,
          lastSyncedAt: new Date(),
        };

        const updated = await prisma.market.updateMany({
          where: { polymarketId: d.polymarketId },
          data: updateData,
        });

        if (updated.count === 0) {
          const [idExists, slugExists] = await Promise.all([
            prisma.market.findUnique({
              where: { id: d.id },
              select: { id: true },
            }),
            prisma.market.findUnique({
              where: { slug: d.slug },
              select: { id: true },
            }),
          ]);
          if (idExists || slugExists) return "skipped";

          await prisma.market.create({
            data: {
              id: d.id,
              polymarketId: d.polymarketId,
              slug: d.slug,
              question: d.question,
              description: d.description,
              category: d.category,
              tags: d.tags,
              outcomes: d.outcomes,
              outcomePrices: d.outcomePrices,
              tokens: d.tokens,
              volume: d.volume,
              volume24h: d.volume24h,
              liquidity: d.liquidity,
              spread: d.spread,
              active: d.active,
              closed: d.closed,
              featured: d.featured,
              isNew: d.isNew,
              imageUrl: d.imageUrl,
              icon: d.icon,
              endDate: d.endDate,
              startDate: d.startDate,
              eventId: d.eventId ?? null,
              lastSyncedAt: new Date(),
            },
          });
          return "created";
        }
        return "updated";
      }),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    count = succeeded;

    if (failed > 0) {
      results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .slice(0, 5)
        .forEach((r) =>
          logger.warn(`Upsert failed: ${r.reason?.message ?? r.reason}`),
        );
    }

    cache.deleteByPrefix("markets:");
    cache.deleteByPrefix("market:");

    const duration = Date.now() - startTime;
    logger.info(
      `✅ Sync done: ${succeeded} saved | ${failed} failed | ${duration}ms`,
    );

    await prisma.syncLog.create({
      data: { type: "markets", status: "success", count, duration },
    });

    return { count, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error(`❌ Sync failed: ${message}`);
    await prisma.syncLog.create({
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
