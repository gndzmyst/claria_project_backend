export declare const cache: {
    /**
     * Simpan data ke cache
     * @param key   - cache key
     * @param data  - data yang disimpan
     * @param ttl   - time-to-live dalam detik
     */
    set<T>(key: string, data: T, ttl: number): void;
    /**
     * Ambil data dari cache
     * Return null jika tidak ada atau sudah expired
     */
    get<T>(key: string): T | null;
    /**
     * Hapus satu entry dari cache
     */
    delete(key: string): void;
    /**
     * Hapus semua entry yang key-nya dimulai dengan prefix tertentu
     * Berguna untuk invalidate semua cache market sekaligus
     */
    deleteByPrefix(prefix: string): void;
    /**
     * Ambil dari cache — jika tidak ada / expired, jalankan fetcher lalu simpan
     * Pattern: stale-while-revalidate sederhana
     *
     * @param key     - cache key
     * @param fetcher - async function untuk ambil data baru
     * @param ttl     - time-to-live dalam detik
     */
    getOrSet<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T>;
    /**
     * Hapus semua isi cache
     */
    clear(): void;
    /**
     * Lihat berapa banyak item di cache (untuk debugging)
     */
    size(): number;
};
