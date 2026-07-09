/**
 * Config for the Dream Company live-vacancy job source (Adzuna + Reed).
 *
 * Kept separate from config/llm.ts (LLM provider/model/key) and config/features.ts
 * (CV Optimizer toggles) so the job-source routing is self-contained. Read lazily at
 * call time — mirrors the getCvOptimizerFeatures() pattern — so a runtime env change
 * (e.g. the DREAM_JOB_SOURCE=exa rollback) takes effect without a code change.
 */

/**
 * Routing mode:
 * - 'hybrid'      — Adzuna/Reed first, Exa as fallback (default)
 * - 'adzuna_reed' — Adzuna/Reed only, no Exa fallback
 * - 'exa'         — legacy Exa only; the byte-identical rollback value
 */
export type JobSourceMode = 'hybrid' | 'adzuna_reed' | 'exa';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_MS = 1_200_000; // 20 minutes
const DEFAULT_FRESHNESS_MAX_DAYS = 7; // "current/active" window (was 45 — too loose)
const DEFAULT_FRESHNESS_HARD_CAP_DAYS = 30; // absolute ceiling: never show anything older
const DEFAULT_MAX_ROLE_QUERIES = 6; // max roles to search (also the FE selection cap)
// Tight timeout: dead links (404/410/5xx) answer in well under this; slow-but-alive
// servers just hit the timeout and are KEPT (fail-open). Combined with a single parallel
// wave (see maybeLiveness), the liveness step adds at most ~this much latency — which is
// what keeps AC8 (< ~2s) true regardless of how slow a board is to answer HEAD.
const DEFAULT_LIVENESS_TIMEOUT_MS = 1500;
// Search radius (km) around the resolved city, passed to Adzuna `distance` and (converted
// to miles) Reed `distanceFromLocation`. Widens the net to nearby towns so a user in a
// smaller place still sees jobs. 0 disables the radius (exact-location search).
const DEFAULT_SEARCH_RADIUS_KM = 25;

/**
 * Resolve DREAM_JOB_SOURCE. Anything outside the three known modes falls back to
 * 'hybrid' with a one-line warning so a typo in prod env degrades safely instead of
 * silently disabling the feature.
 */
export function getJobSourceMode(): JobSourceMode {
  const raw = process.env.DREAM_JOB_SOURCE?.trim().toLowerCase();
  if (raw === 'hybrid' || raw === 'adzuna_reed' || raw === 'exa') {
    return raw;
  }
  if (raw) {
    // eslint-disable-next-line no-console
    console.warn(`[job-source] Unknown DREAM_JOB_SOURCE="${raw}" — falling back to "hybrid".`);
  }
  return 'hybrid';
}

/** Per-source HTTP timeout in ms (JOB_SOURCE_TIMEOUT_MS), default 8000. */
export function getJobSourceTimeoutMs(): number {
  return positiveIntEnv('JOB_SOURCE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
}

/** In-memory job-cache TTL in ms (JOB_CACHE_TTL_MS), default 20 min. */
export function getJobCacheTtlMs(): number {
  return positiveIntEnv('JOB_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS);
}

/**
 * Preferred freshness window in days (JOB_FRESHNESS_MAX_DAYS), default 7. Jobs newer
 * than this are shown first; the orchestrator only widens the window (up to the hard
 * cap) if too few jobs pass. Violet's target is "current/active" — set to 2 for a
 * stricter 48h window if the role pool is large enough to still return jobs.
 */
export function getJobFreshnessMaxDays(): number {
  return positiveIntEnv('JOB_FRESHNESS_MAX_DAYS', DEFAULT_FRESHNESS_MAX_DAYS);
}

/**
 * Absolute freshness ceiling in days (JOB_FRESHNESS_HARD_CAP_DAYS), default 30. No job
 * older than this is ever returned — this is the guarantee that replaces the old
 * "return the unfiltered list" fallback.
 */
export function getJobFreshnessHardCapDays(): number {
  return positiveIntEnv('JOB_FRESHNESS_HARD_CAP_DAYS', DEFAULT_FRESHNESS_HARD_CAP_DAYS);
}

/**
 * Max number of roles a search covers (JOB_MAX_ROLE_QUERIES), default 6. This is the
 * single source of truth for BOTH the backend cap AND the FE selection limit (the FE
 * reads it from GET /api/dream-company/config), so changing the env on Railway updates
 * both without a frontend deploy. Each role = 2 API calls (Adzuna + Reed), so this also
 * bounds the per-request call count at 2×N.
 */
export function getJobMaxRoleQueries(): number {
  return positiveIntEnv('JOB_MAX_ROLE_QUERIES', DEFAULT_MAX_ROLE_QUERIES);
}

/** Whether to HTTP-check job URLs and drop dead links (JOB_LIVENESS_ENABLED), default true. */
export function isJobLivenessEnabled(): boolean {
  const raw = process.env.JOB_LIVENESS_ENABLED?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

/** Per-URL liveness-check timeout in ms (JOB_LIVENESS_TIMEOUT_MS), default 4000. */
export function getJobLivenessTimeoutMs(): number {
  return positiveIntEnv('JOB_LIVENESS_TIMEOUT_MS', DEFAULT_LIVENESS_TIMEOUT_MS);
}

/**
 * Search radius in km (JOB_SEARCH_RADIUS_KM), default 25. Applied around the resolved
 * city on both Adzuna (km) and Reed (converted to miles). Set to 0 to disable and search
 * the exact location only. Allows 0, so we don't reuse positiveIntEnv here.
 */
export function getJobSearchRadiusKm(): number {
  const raw = process.env.JOB_SEARCH_RADIUS_KM?.trim();
  if (!raw) return DEFAULT_SEARCH_RADIUS_KM;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    // eslint-disable-next-line no-console
    console.warn(`[job-source] Invalid JOB_SEARCH_RADIUS_KM="${raw}" — using default ${DEFAULT_SEARCH_RADIUS_KM}.`);
    return DEFAULT_SEARCH_RADIUS_KM;
  }
  return Math.floor(n);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    // eslint-disable-next-line no-console
    console.warn(`[job-source] Invalid ${name}="${raw}" — using default ${fallback}.`);
    return fallback;
  }
  return Math.floor(n);
}
