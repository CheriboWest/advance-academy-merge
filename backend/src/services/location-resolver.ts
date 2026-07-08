/**
 * LLM location resolver (Dream Company — Issue 2, layer 2 of the hybrid router).
 *
 * The static router (routeLocation in job-search.service) only recognises a location when
 * a country name or a gazetteer city appears literally. Anything it can't place — a
 * misspelling ("Londn"), an unlisted town, an ambiguous free-text location — falls to
 * "unsupported" and the user sees no jobs even when they're in a covered country.
 *
 * This resolver is the fallback: one cheap LLM call maps free-text → an ISO country code
 * + a canonical city. We then validate the country against the Adzuna-supported set; a
 * country we don't cover (e.g. Vietnam → "vn") resolves to null so the honest "no
 * coverage" notice still shows (we deliberately never fall back to Exa — see routeLocation).
 *
 * It is FAIL-OPEN: any error/timeout returns { countryCode: null, city: null } so the
 * roadmap flow is never blocked. Definitive answers (including "not a covered country")
 * are cached; transient LLM errors are not, so a blip doesn't pin a wrong "unsupported".
 */
import type { CostBucket } from '../lib/cost-tracker.js';
import { createAnthropicClient, getFeatureModel, withRetry } from '../lib/llm-anthropic.js';
import { withJobCache } from '../lib/job-cache.js';

/**
 * Adzuna-supported country codes (+ 'gb' for the UK route). Kept in sync with
 * ADZUNA_COUNTRY_MAP in job-search.service — the static regex layer and this validation
 * layer must agree on which countries have live-vacancy coverage.
 */
export const SUPPORTED_COUNTRY_CODES = new Set<string>([
  'gb', 'us', 'au', 'ca', 'de', 'fr', 'in', 'nl', 'sg', 'nz',
  'es', 'it', 'pl', 'br', 'za', 'ch', 'at', 'be', 'mx',
]);

export interface ResolvedLocation {
  /** A supported ISO 3166-1 alpha-2 code (lowercase), or null if uncovered/unresolved. */
  countryCode: string | null;
  /** Canonical city/area to use as the search anchor, or null. */
  city: string | null;
}

const NONE: ResolvedLocation = { countryCode: null, city: null };

// Location→country is effectively permanent, so cache aggressively (24h) to keep the LLM
// call rare — most repeat locations never reach the model twice.
const LOC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Small, fast call: the output is a two-field JSON object (~30 tokens).
const MAX_TOKENS = 120;
const RESOLVE_TIMEOUT_MS = 8000;

/**
 * Normalise a raw country string from the LLM to a supported lowercase code, or null.
 * Handles the common "uk" alias for the UK (ISO is "gb") and rejects anything outside the
 * supported set (uncovered country, empty, or a hallucinated value). Pure — unit-tested.
 */
export function normalizeResolvedCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let code = raw.trim().toLowerCase();
  if (!code || code === 'null') return null;
  if (code === 'uk') code = 'gb';
  return SUPPORTED_COUNTRY_CODES.has(code) ? code : null;
}

function cleanCity(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim();
  if (!c || c.toLowerCase() === 'null') return null;
  return c.slice(0, 80);
}

function buildPrompt(location: string): string {
  return [
    'Map this job-seeker location to a country and a city.',
    '',
    `Location: "${location}"`,
    '',
    'Rules:',
    '- Infer the real country even if the user omitted it or misspelled the city.',
    '- "country" MUST be a lowercase ISO 3166-1 alpha-2 code (e.g. "gb", "us", "de"). Use "gb" for the United Kingdom.',
    '- "city" is the main city/area in its common English spelling (e.g. "San Francisco", "Munich"). Use null if you truly cannot tell.',
    '- If the location is not a real place, set both to null.',
    '',
    'Return ONLY minified JSON, no prose: {"country":"<code|null>","city":"<name|null>"}',
  ].join('\n');
}

/** The actual LLM call. Throws on API error (so the cache wrapper won't cache a blip). */
async function callLlm(location: string, costBucket?: CostBucket): Promise<ResolvedLocation> {
  const anthropic = createAnthropicClient('dreamCompany', { timeoutMs: RESOLVE_TIMEOUT_MS, maxRetries: 0 });
  const model = getFeatureModel('dreamCompany');

  const response = await withRetry(() => anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: 'You resolve free-text locations to a country and city. Return only valid minified JSON.',
    messages: [{ role: 'user', content: buildPrompt(location) }],
  }));
  costBucket?.llm('dreamCompany.locationResolve', model, response.usage);

  const block = response.content[0];
  const text = block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
  const parsed = safeParseJson(text);
  if (!parsed) {
    console.warn(`[location-resolver] unparseable LLM output for "${location}": ${text.slice(0, 120)}`);
    return NONE;
  }
  const countryCode = normalizeResolvedCountry(parsed.country);
  return { countryCode, city: countryCode ? cleanCity(parsed.city) : null };
}

function safeParseJson(text: string): { country?: unknown; city?: unknown } | null {
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim();
  try {
    const obj = JSON.parse(stripped);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a free-text location to a supported country + city via the LLM, cached and
 * fail-open. Returns { countryCode: null, city: null } for blank input, an uncovered
 * country, or any LLM failure — the caller treats null as "still unsupported".
 */
export async function resolveLocationWithLlm(
  location: string,
  costBucket?: CostBucket,
): Promise<ResolvedLocation> {
  const loc = (location ?? '').trim();
  if (!loc) return NONE;
  try {
    const { value } = await withJobCache<ResolvedLocation>(
      `locres|${loc.toLowerCase()}`,
      LOC_CACHE_TTL_MS,
      () => callLlm(loc, costBucket),
    );
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[location-resolver] resolve failed for "${loc}", fail-open: ${message}`);
    return NONE;
  }
}
