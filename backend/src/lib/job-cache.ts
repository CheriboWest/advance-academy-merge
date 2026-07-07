/**
 * Tiny in-memory TTL cache for job-search results (JS-5).
 *
 * Process-local Map — deliberately NOT shared across Railway instances (a soft cache;
 * a miss just re-fetches). TTL comes from JOB_CACHE_TTL_MS (config/job-source). Only
 * successful results should be cached by callers so a transient outage isn't pinned
 * for the whole TTL.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Build a stable cache key from role titles + location (order-insensitive on roles). */
export function buildJobCacheKey(mode: string, location: string, roleTitles: string[]): string {
  const roles = [...roleTitles].map((r) => r.trim().toLowerCase()).sort().join(',');
  return `${mode}|${location.trim().toLowerCase()}|${roles}`;
}

export function getCachedJobs<T>(key: string, now: number = Date.now()): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCachedJobs<T>(key: string, value: T, ttlMs: number, now: number = Date.now()): void {
  store.set(key, { value, expiresAt: now + ttlMs });
}

/**
 * Return the cached value for `key`, or run `producer`, cache it (only when
 * `shouldCache` returns true), and return it. `now` is injectable for tests.
 */
export async function withJobCache<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
  opts: { now?: number; shouldCache?: (value: T) => boolean } = {},
): Promise<{ value: T; hit: boolean }> {
  const now = opts.now ?? Date.now();
  const cached = getCachedJobs<T>(key, now);
  if (cached !== undefined) return { value: cached, hit: true };
  const value = await producer();
  if (!opts.shouldCache || opts.shouldCache(value)) {
    setCachedJobs(key, value, ttlMs, now);
  }
  return { value, hit: false };
}

/** Test helper — wipe the cache between cases. */
export function clearJobCache(): void {
  store.clear();
}
