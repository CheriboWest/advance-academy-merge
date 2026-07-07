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
