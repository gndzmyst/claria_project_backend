export declare const gammaClient: import("axios").AxiosInstance;
export declare const clobClient: import("axios").AxiosInstance;
export declare const dataClient: import("axios").AxiosInstance;
export interface GammaMarket {
    id: string;
    condition_id: string;
    slug: string;
    question: string;
    description: string;
    category: string;
    tags: string[];
    outcomes: string[];
    outcome_prices: string;
    tokens: Array<{
        token_id: string;
        outcome: string;
    }>;
    volume: string;
    volume_24hr: string;
    liquidity: string;
    active: boolean;
    closed: boolean;
    new: boolean;
    featured: boolean;
    end_date_iso: string;
    start_date_iso: string;
    image: string;
    icon: string;
    event_id: string;
}
export interface GammaEvent {
    id: string;
    slug: string;
    title: string;
    description: string;
    category: string;
    image: string;
    start_date: string;
    end_date: string;
    active: boolean;
    closed: boolean;
    markets: GammaMarket[];
}
export interface ClobOrderBook {
    market: string;
    asset_id: string;
    bids: Array<{
        price: string;
        size: string;
    }>;
    asks: Array<{
        price: string;
        size: string;
    }>;
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
/**
 * Ambil daftar market aktif dari Polymarket
 */
export declare function fetchGammaMarkets(params?: {
    limit?: number;
    offset?: number;
    active?: boolean;
    closed?: boolean;
    category?: string;
    tag?: string;
    order?: string;
    ascending?: boolean;
}): Promise<GammaMarket[]>;
/**
 * Ambil detail satu market berdasarkan conditionId
 */
export declare function fetchGammaMarketById(conditionId: string): Promise<GammaMarket>;
/**
 * Ambil daftar events dari Polymarket
 */
export declare function fetchGammaEvents(params?: {
    limit?: number;
    offset?: number;
    category?: string;
    active?: boolean;
}): Promise<GammaEvent[]>;
/**
 * Ambil order book real-time untuk satu token
 * @param tokenId - dari market.tokens[].token_id
 */
export declare function fetchOrderBook(tokenId: string): Promise<ClobOrderBook>;
/**
 * Ambil price history untuk chart
 * @param tokenId - dari market.tokens[].token_id
 * @param interval - resolusi data
 */
export declare function fetchPriceHistory(tokenId: string, interval?: "1m" | "1h" | "6h" | "1d" | "1w" | "all"): Promise<ClobPricePoint[]>;
/**
 * Ambil harga terakhir untuk satu token
 */
export declare function fetchLastTradePrice(tokenId: string): Promise<number>;
/**
 * Ambil posisi trading user dari Polymarket (real, bukan simulasi)
 * Hanya tersedia jika user sudah connect wallet dan pernah trading di Polymarket
 */
export declare function fetchUserPositions(walletAddress: string): Promise<PolymarketPosition[]>;
/**
 * Ambil histori aktivitas user dari Polymarket
 */
export declare function fetchUserActivity(walletAddress: string, limit?: number): Promise<unknown[]>;
