import prisma from "../utils/prisma";
import { cache } from "../utils/cache";
import { logger } from "../utils/logger";
import {
  fetchGammaEvents,
  fetchGammaEventBySlug,
  fetchGammaMarketByConditionId,
  fetchGammaMarketBySlug,
  fetchGammaSearch,
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
  Trending: undefined,
  New: undefined,
  Politics: POLYMARKET_TAG_IDS.Politics, // 2
  Crypto: POLYMARKET_TAG_IDS.Crypto, // 21
  Sports: POLYMARKET_TAG_IDS.Sports, // 100639
};

const BLACKLIST_TAGS = ["Recurring", "Hide From New"];
const MIN_REMAINING_MS = 60 * 60 * 1000; // 1 jam

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parseJsonArray
// GammaEventMarket.outcomes / outcomePrices / clobTokenIds = JSON string
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
// Handle tipe campuran: event level = number, market level = string
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
    // Market level: string | number campuran → safeFloat, fallback ke event level
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
// Helper: mapTagsToCategory
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
    allText.includes("xrp")
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
    allText.includes("ceasefire")
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
    allText.includes("cwbb") ||
    allText.includes("cbb ") ||
    allText.includes("wnba") ||
    allText.includes("serie a") ||
    allText.includes("bundesliga") ||
    allText.includes("la liga") ||
    allText.includes("ligue 1") ||
    allText.includes("ligue 2")
  )
    return "Sports";

  return "Trending";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: isRecurringMarket
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

  if (category === "Trending") {
    if (volume === 0 && volume24h === 0 && liquidity === 0) return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: enrichWithRealPrices
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
// getMarkets
//
// ✅ PERBAIKAN FINAL berdasarkan analisa semua error log + docs resmi:
//
// MASALAH 1 (code asli): active=true → 422 "field not valid"
//   → "active" tidak ada di query params docs /events
//   → SOLUSI: HAPUS active dari semua call
//
// MASALAH 2 (fix sebelumnya): order=volume_24hr → 422 "order fields are not valid"
//   → "volume_24hr" bukan nama field response (nama asli camelCase: "volume24hr")
//   → SOLUSI: HAPUS order untuk Trending/Politics/Crypto
//             Default ordering Polymarket API sudah berdasarkan volume/trending
//             Hanya Sports yang perlu order=startDate
//
// PARAMETER AMAN:
//   - limit: ≤ 100 (docs: "Required range: x >= 0")
//   - closed: false (valid per docs, pengganti active=true)
//   - tag_id: integer (valid per docs)
//   - order: hanya untuk Sports dengan "startDate" (nama field asli)
//   - ascending: tidak dikirim (false adalah default, tidak perlu)
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

      if (params?.search) {
        // ── Search: gunakan fetchGammaSearch (title_contains) ──────────────
        events = await fetchGammaSearch(params.search, 50);
      } else if (category === "New") {
        // ── New: fetch tanpa order (default API = newest/trending)
        // Filter di client side: event.new === true
        events = await fetchGammaEvents({
          limit: Math.min(limit + offset + 40, 100),
          closed: false,
          // TIDAK ada order — biarkan API default
        });
        const newEvents = events.filter((e) => e.new === true);
        events = newEvents.length >= limit ? newEvents : events;
      } else if (category === "Sports") {
        // ── Sports: order=startDate (nama field asli) untuk upcoming games
        // "startDate" adalah field valid di response GammaEvent
        // ascending tidak dikirim (false = terbaru dulu, tidak ada ascending conflict)
        events = await fetchGammaEvents({
          limit: Math.min(limit + offset + 60, 100),
          closed: false,
          tag_id: POLYMARKET_TAG_IDS.Sports,
          order: "startDate", // field asli dari response, bukan "start_date"
          // ascending TIDAK dikirim — default false = descending = terbaru dulu
        });
      } else if (category === "Trending") {
        // ── Trending: TANPA order — default Polymarket sudah trending/volume
        events = await fetchGammaEvents({
          limit: Math.min((limit + offset) * 2, 100),
          closed: false,
          // TIDAK ada order — API default sudah sort by volume/trending
        });
      } else {
        // ── Politics, Crypto: filter by tag_id, tanpa order
        events = await fetchGammaEvents({
          limit: Math.min((limit + offset) * 2, 100),
          closed: false,
          tag_id: CATEGORY_TAG_MAP[category],
          // TIDAK ada order — biarkan API default
        });
      }

      const now = new Date();
      const allMarkets: AuroraMarket[] = [];

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
          const tagLabels = [
            ...new Set([...eventTagLabels, ...marketTagLabels]),
          ];

          if (isRecurringMarket(market, tagLabels)) return;

          // Sports: skip market yang sudah expired
          if (category === "Sports" && market.endDate) {
            if (new Date(market.endDate) < now) return;
          }

          // Skip market expired + zero volume24h (sudah tidak aktif)
          const endDate = market.endDate ? new Date(market.endDate) : null;
          if (endDate && endDate < now && safeFloat(market.volume24hr) === 0)
            return;

          if (!shouldShowMarket(market, category, now)) return;

          allMarkets.push(transformEventMarket(market, event));
        });
      });

      const sliced = allMarkets.slice(offset, offset + limit);
      return enrichWithRealPrices(sliced);
    },
    CACHE_TTL,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// getMarketDetail
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
//
// ✅ PERBAIKAN:
//   - Tidak ada active=true
//   - Tidak ada order param untuk Trending (API default cukup)
//   - Tidak ada order param untuk per-kategori (API default cukup)
//   - closed=false untuk filter event terbuka
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

    // ── Fetch Trending (tanpa order — default API sudah trending) ────────────
    try {
      const events = await fetchGammaEvents({
        limit: 100,
        closed: false,
        // TIDAK ada order — default API
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
      logger.debug(`Trending fetch done`);
    } catch (err) {
      logger.warn(`Failed trending fetch: ${(err as Error).message}`);
    }

    // ── Fetch per kategori (tanpa order — default API cukup) ─────────────────
    const categories = [
      { name: "Politics", tagId: POLYMARKET_TAG_IDS.Politics },
      { name: "Crypto", tagId: POLYMARKET_TAG_IDS.Crypto },
      { name: "Sports", tagId: POLYMARKET_TAG_IDS.Sports },
    ];

    for (const cat of categories) {
      try {
        const events = await fetchGammaEvents({
          limit: 50,
          closed: false,
          tag_id: cat.tagId,
          // TIDAK ada order — default API
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
        logger.debug(`${cat.name} fetch done`);
      } catch (err) {
        logger.warn(`Failed ${cat.name} fetch: ${(err as Error).message}`);
      }
    }

    logger.info(`Processing ${allMarkets.length} unique markets...`);

    // ── Step 1: Upsert Events (FK constraint) ────────────────────────────────
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

    // ── Step 2: Upsert Markets ────────────────────────────────────────────────
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

        // Update by polymarketId (lebih reliable)
        const updated = await prisma.market.updateMany({
          where: { polymarketId: d.polymarketId },
          data: updateData,
        });

        if (updated.count === 0) {
          // Cek conflict sebelum create
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
