// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory cache dengan TTL
// Digunakan untuk mengurangi request berulang ke Polymarket API
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const cache = {
  /**
   * Simpan data ke cache
   * @param key   - cache key
   * @param data  - data yang disimpan
   * @param ttl   - time-to-live dalam detik
   */
  set<T>(key: string, data: T, ttl: number): void {
    store.set(key, {
      data,
      expiresAt: Date.now() + ttl * 1000,
    });
  },

  /**
   * Ambil data dari cache
   * Return null jika tidak ada atau sudah expired
   */
  get<T>(key: string): T | null {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.data;
  },

  /**
   * Hapus satu entry dari cache
   */
  delete(key: string): void {
    store.delete(key);
  },

  /**
   * Hapus semua entry yang key-nya dimulai dengan prefix tertentu
   * Berguna untuk invalidate semua cache market sekaligus
   */
  deleteByPrefix(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  },

  /**
   * Ambil dari cache — jika tidak ada / expired, jalankan fetcher lalu simpan
   * Pattern: stale-while-revalidate sederhana
   *
   * @param key     - cache key
   * @param fetcher - async function untuk ambil data baru
   * @param ttl     - time-to-live dalam detik
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const cached = cache.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fetcher();
    cache.set(key, fresh, ttl);
    return fresh;
  },

  /**
   * Hapus semua isi cache
   */
  clear(): void {
    store.clear();
  },

  /**
   * Lihat berapa banyak item di cache (untuk debugging)
   */
  size(): number {
    return store.size;
  },
};
