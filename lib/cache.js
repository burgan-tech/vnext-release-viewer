const MAX_CACHE_ENTRIES = 64;
const DEFAULT_STALE_MS = 10 * 60 * 1000;

/**
 * In-memory TTL cache for API responses. Evicts oldest when over max entries.
 * @param {number} ttlMs - TTL in milliseconds
 * @returns {{ getCached: Function, setCache: Function, getOrLoad: Function }}
 */
function createCache(ttlMs) {
  const store = new Map(); // Map ekleme sırasını korur → en eski anahtar ilk sırada
  const inflight = new Map();

  function getCached(key) {
    const entry = store.get(key);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.data;
  }

  function setCache(key, data, overrideTtlMs) {
    store.delete(key);
    if (store.size >= MAX_CACHE_ENTRIES) store.delete(store.keys().next().value);
    store.set(key, { data, expires: Date.now() + (overrideTtlMs ?? ttlMs) });
  }

  // Aynı anahtar için eşzamanlı istekler tek bir yüklemeyi paylaşır
  function load(key, loader, ttl) {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve()
      .then(loader)
      .then((data) => { setCache(key, data, ttl); return data; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /**
   * Taze veri → hemen döner. Süresi dolmuş ama staleMs içindeki veri → hemen döner, arka planda yenilenir.
   * Veri yok / çok eski / force → yüklemeyi bekler.
   */
  function getOrLoad(key, loader, { ttlMs: ttl = ttlMs, staleMs = DEFAULT_STALE_MS, force = false } = {}) {
    const entry = store.get(key);
    if (!force && entry) {
      const now = Date.now();
      if (now <= entry.expires) return Promise.resolve(entry.data);
      if (now <= entry.expires + staleMs) {
        load(key, loader, ttl).catch(() => {});
        return Promise.resolve(entry.data);
      }
    }
    return load(key, loader, ttl);
  }

  return { getCached, setCache, getOrLoad };
}

module.exports = { createCache };
