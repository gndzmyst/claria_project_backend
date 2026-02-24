"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory cache dengan TTL
// Digunakan untuk mengurangi request berulang ke Polymarket API
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.cache = void 0;
const store = new Map();
exports.cache = {
    /**
     * Simpan data ke cache
     * @param key   - cache key
     * @param data  - data yang disimpan
     * @param ttl   - time-to-live dalam detik
     */
    set(key, data, ttl) {
        store.set(key, {
            data,
            expiresAt: Date.now() + ttl * 1000,
        });
    },
    /**
     * Ambil data dari cache
     * Return null jika tidak ada atau sudah expired
     */
    get(key) {
        const entry = store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            store.delete(key);
            return null;
        }
        return entry.data;
    },
    /**
     * Hapus satu entry dari cache
     */
    delete(key) {
        store.delete(key);
    },
    /**
     * Hapus semua entry yang key-nya dimulai dengan prefix tertentu
     * Berguna untuk invalidate semua cache market sekaligus
     */
    deleteByPrefix(prefix) {
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
    async getOrSet(key, fetcher, ttl) {
        const cached = exports.cache.get(key);
        if (cached !== null)
            return cached;
        const fresh = await fetcher();
        exports.cache.set(key, fresh, ttl);
        return fresh;
    },
    /**
     * Hapus semua isi cache
     */
    clear() {
        store.clear();
    },
    /**
     * Lihat berapa banyak item di cache (untuk debugging)
     */
    size() {
        return store.size;
    },
};
//# sourceMappingURL=cache.js.map