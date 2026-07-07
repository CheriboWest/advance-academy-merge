/**
 * Live-vacancy job-search orchestrator (Dream Company).
 *
 * Replaces the single Exa call with a location-routed source strategy:
 *   - UK              → Adzuna (gb) + Reed, merged
 *   - Adzuna-covered  → Adzuna (that country)
 *   - elsewhere / flag=exa → legacy Exa search (byte-identical to the old path)
 *
 * On any primary-source failure it falls back to the remaining source, then to Exa,
 * then to a clean `{ jobs: [], error: AAT-10 }`. It NEVER throws — a broken job source
 * must not take down the roadmap (work order §6 DoD #5).
 *
 * Output shape is the unchanged `ExaJobListing[]` so every downstream consumer
 * (prompt builder, RoadmapResponse, frontend) is untouched.
 *
 * NOTE: dedupe + in-memory cache land in JS-5; this file owns routing, normalize,
 * freshness filtering and the fallback chain (JS-3).
 */
import type { ExaJobListing } from '../types/dream-company.js';
import type { CostBucket } from '../lib/cost-tracker.js';
import { getExaClient, withExaRetry } from '../lib/exa-client.js';
import { searchAdzuna, type AdzunaResult } from '../lib/adzuna-client.js';
import { searchReed, type ReedResult } from '../lib/reed-client.js';
import { getJobSourceMode, getJobCacheTtlMs, type JobSourceMode } from '../config/job-source.js';
import { buildJobCacheKey, withJobCache } from '../lib/job-cache.js';

// Kept identical to the previous inline Exa options so `flag=exa` reproduces the old
// behaviour exactly (work order §6 DoD #6).
const EXA_OPTIONS = {
  useAutoprompt: true,
  type: 'fast',
  numResults: 20,
} as const;

/** The distinct failure state when no source could return jobs (AAT-10). */
export const JOBS_UNAVAILABLE_ERROR =
  'Could not load live job listings — the job search service is unavailable. Your roadmap below is still valid.';

const MAX_JOBS = 20;
const FRESHNESS_MAX_DAYS = 45;
const FRESHNESS_MIN_KEEP = 8;
const PER_SOURCE_RESULTS = 15;

export interface JobSearchInput {
  /** Selected target-role titles, used to build the keyword query. */
  roleTitles: string[];
  /** Free-text location from the user's profile. */
  location: string;
}

export interface JobSearchResult {
  jobs: ExaJobListing[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface JobRoute {
  kind: 'uk' | 'adzuna' | 'exa';
  /** Adzuna country code for 'uk' ('gb') and 'adzuna' routes. */
  country?: string;
}

const UK_REGEX =
  /\b(uk|u\.k\.|united kingdom|great britain|britain|england|scotland|wales|northern ireland|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|cardiff|belfast|sheffield|nottingham)\b/i;

// Location keyword → Adzuna country code (the countries Adzuna's API covers).
const ADZUNA_COUNTRY_MAP: Array<{ re: RegExp; code: string }> = [
  { re: /\b(united states|u\.s\.a?\.?|usa|america)\b/i, code: 'us' },
  { re: /\b(australia)\b/i, code: 'au' },
  { re: /\b(canada)\b/i, code: 'ca' },
  { re: /\b(germany|deutschland)\b/i, code: 'de' },
  { re: /\b(france)\b/i, code: 'fr' },
  { re: /\b(india)\b/i, code: 'in' },
  { re: /\b(netherlands|holland)\b/i, code: 'nl' },
  { re: /\b(singapore)\b/i, code: 'sg' },
  { re: /\b(new zealand)\b/i, code: 'nz' },
  { re: /\b(spain|españa)\b/i, code: 'es' },
  { re: /\b(italy|italia)\b/i, code: 'it' },
  { re: /\b(poland|polska)\b/i, code: 'pl' },
  { re: /\b(brazil|brasil)\b/i, code: 'br' },
  { re: /\b(south africa)\b/i, code: 'za' },
  { re: /\b(switzerland|schweiz)\b/i, code: 'ch' },
  { re: /\b(austria|österreich)\b/i, code: 'at' },
  { re: /\b(belgium|belgië|belgique)\b/i, code: 'be' },
  { re: /\b(mexico|méxico)\b/i, code: 'mx' },
  // "US" as a bare token last, so it doesn't shadow words like "Australia".
  { re: /(^|[\s,])us([\s,]|$)/i, code: 'us' },
];

/**
 * Decide which source to use for a location. `mode='exa'` forces the legacy path;
 * otherwise UK → uk, a covered country → adzuna, anything else → exa (D3 fallback).
 */
export function routeLocation(location: string, mode: JobSourceMode): JobRoute {
  if (mode === 'exa') return { kind: 'exa' };
  const loc = location ?? '';
  if (UK_REGEX.test(loc)) return { kind: 'uk', country: 'gb' };
  for (const { re, code } of ADZUNA_COUNTRY_MAP) {
    if (re.test(loc)) return { kind: 'adzuna', country: code };
  }
  return { kind: 'exa' };
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/** Format the salary/company/description prefix shared by both providers. */
function buildSnippet(
  salaryMin: number | null | undefined,
  salaryMax: number | null | undefined,
  company: string | undefined,
  description: string | undefined,
): string {
  const parts: string[] = [];
  const salary = formatSalary(salaryMin, salaryMax);
  if (salary) parts.push(salary);
  if (company) parts.push(company);
  const head = parts.join(' · ');
  const desc = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (head && desc) return `${head} — ${desc}`;
  return head || desc;
}

function formatSalary(min: number | null | undefined, max: number | null | undefined): string {
  const lo = typeof min === 'number' && min > 0 ? min : undefined;
  const hi = typeof max === 'number' && max > 0 ? max : undefined;
  if (lo && hi) return `£${fmtK(lo)}–${fmtK(hi)}`;
  if (lo) return `£${fmtK(lo)}+`;
  if (hi) return `up to £${fmtK(hi)}`;
  return '';
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

export function normalizeAdzuna(result: AdzunaResult): ExaJobListing {
  return {
    title: result.title ?? result.redirect_url ?? 'Untitled role',
    url: result.redirect_url ?? '',
    snippet: buildSnippet(result.salary_min, result.salary_max, result.company?.display_name, result.description),
    publishedDate: result.created || undefined,
  };
}

export function normalizeReed(result: ReedResult): ExaJobListing {
  return {
    title: result.jobTitle ?? result.jobUrl ?? 'Untitled role',
    url: result.jobUrl ?? '',
    snippet: buildSnippet(result.minimumSalary, result.maximumSalary, result.employerName, result.jobDescription),
    publishedDate: reedDateToIso(result.date),
  };
}

/** Convert Reed's DD/MM/YYYY to an ISO date string; undefined if unparseable. */
export function reedDateToIso(ddmmyyyy: string | undefined): string | undefined {
  if (!ddmmyyyy) return undefined;
  const m = ddmmyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** True when a Reed vacancy has no expiry or its expiry is today-or-later. */
export function reedNotExpired(result: ReedResult, now: Date): boolean {
  const iso = reedDateToIso(result.expirationDate);
  if (!iso) return true; // no/invalid expiry → keep
  return Date.parse(iso) >= startOfDay(now);
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ---------------------------------------------------------------------------
// Freshness filter (D2)
// ---------------------------------------------------------------------------

/**
 * Drop jobs older than `maxDays`. Jobs with no/invalid publishedDate are kept (we
 * can't judge them). If the filtered set would fall below `minKeep`, the filter is
 * abandoned and the original list is returned — a sparse UK role shouldn't show zero
 * vacancies (work order D2 / risk "UK role hiếm").
 */
export function applyFreshness(
  jobs: ExaJobListing[],
  opts: { now: Date; maxDays?: number; minKeep?: number },
): ExaJobListing[] {
  const maxDays = opts.maxDays ?? FRESHNESS_MAX_DAYS;
  const minKeep = opts.minKeep ?? FRESHNESS_MIN_KEEP;
  const cutoff = opts.now.getTime() - maxDays * 24 * 60 * 60 * 1000;
  const fresh = jobs.filter((j) => {
    if (!j.publishedDate) return true;
    const t = Date.parse(j.publishedDate);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
  return fresh.length < minKeep ? jobs : fresh;
}

// ---------------------------------------------------------------------------
// Merge / finalize
// ---------------------------------------------------------------------------

/** Dedupe (by URL host+path), sort newest-first (undated last), and cap. */
export function finalizeJobs(jobs: ExaJobListing[], cap: number = MAX_JOBS): ExaJobListing[] {
  const deduped = dedupeJobs(jobs.filter((j) => j.url));
  const sorted = [...deduped].sort((a, b) => publishedMs(b) - publishedMs(a));
  return sorted.slice(0, cap);
}

/**
 * Remove duplicate postings keyed by URL host+path (case-insensitive, query/hash and
 * trailing slash ignored). We intentionally do NOT collapse by title alone — two
 * distinct employers routinely post an identically-titled role ("Data Analyst"), and
 * merging them would hide a real vacancy. Same-URL dupes (e.g. an Adzuna redirect seen
 * twice, or the same posting across pages) are the safe, unambiguous case to drop.
 */
export function dedupeJobs(jobs: ExaJobListing[]): ExaJobListing[] {
  const seen = new Set<string>();
  const out: ExaJobListing[] = [];
  for (const job of jobs) {
    const key = urlDedupeKey(job.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

function urlDedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.host.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function publishedMs(j: ExaJobListing): number {
  if (!j.publishedDate) return 0;
  const t = Date.parse(j.publishedDate);
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------------------
// Exa (legacy) — kept byte-identical to the previous inline implementation
// ---------------------------------------------------------------------------

async function searchExa(input: JobSearchInput, costBucket?: CostBucket): Promise<ExaJobListing[]> {
  const exa = getExaClient();
  const roleTitles = input.roleTitles.join(' OR ');
  const query = `${roleTitles} hiring ${input.location}`;
  const searchResponse = await withExaRetry(() => exa.searchAndContents(query, EXA_OPTIONS));
  costBucket?.exa('exa.search.jobs', 1);
  return searchResponse.results.map(
    (result: { title: string | null; url: string; text?: string; publishedDate?: string }) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: (result.text ?? '').slice(0, 200),
      publishedDate: result.publishedDate ?? undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// Source fetchers (Adzuna / Reed / UK-combined)
// ---------------------------------------------------------------------------

async function fetchAdzuna(country: string, input: JobSearchInput, costBucket?: CostBucket): Promise<ExaJobListing[]> {
  const what = input.roleTitles.join(' ');
  const results = await searchAdzuna({ country, what, where: input.location, resultsPerPage: PER_SOURCE_RESULTS });
  logSourceCall(costBucket, 'adzuna', results.length);
  return results.map(normalizeAdzuna);
}

async function fetchReed(input: JobSearchInput, now: Date, costBucket?: CostBucket): Promise<ExaJobListing[]> {
  const keywords = input.roleTitles.join(' ');
  const results = await searchReed({ keywords, locationName: input.location, resultsToTake: PER_SOURCE_RESULTS });
  logSourceCall(costBucket, 'reed', results.length);
  return results.filter((r) => reedNotExpired(r, now)).map(normalizeReed);
}

/**
 * UK route: query Adzuna (gb) and Reed concurrently. Each source is independently
 * tolerant — one failing still returns the other's jobs. Only when BOTH fail do we
 * signal failure (by returning null) so the caller can fall through to Exa.
 */
async function fetchUk(input: JobSearchInput, now: Date, costBucket?: CostBucket): Promise<ExaJobListing[] | null> {
  const [adz, reed] = await Promise.allSettled([
    fetchAdzuna('gb', input, costBucket),
    fetchReed(input, now, costBucket),
  ]);
  if (adz.status === 'rejected') logSourceError('adzuna', adz.reason);
  if (reed.status === 'rejected') logSourceError('reed', reed.reason);
  if (adz.status === 'rejected' && reed.status === 'rejected') return null;
  const jobs = [
    ...(adz.status === 'fulfilled' ? adz.value : []),
    ...(reed.status === 'fulfilled' ? reed.value : []),
  ];
  return jobs;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Search for live vacancies for the given roles/location. Never throws: on total
 * failure returns `{ jobs: [], error: JOBS_UNAVAILABLE_ERROR }`. Results are cached
 * in-memory per (mode|location|roles) for JOB_CACHE_TTL_MS; only successful lookups
 * (error === null) are cached so an outage isn't pinned for the whole TTL.
 */
export async function searchLiveJobs(input: JobSearchInput, costBucket?: CostBucket): Promise<JobSearchResult> {
  const mode = getJobSourceMode();
  const cacheKey = buildJobCacheKey(mode, input.location, input.roleTitles);
  const { value, hit } = await withJobCache<JobSearchResult>(
    cacheKey,
    getJobCacheTtlMs(),
    () => runSearch(input, mode, costBucket),
    { shouldCache: (r) => r.error === null },
  );
  console.log(`[job-search] cache=${hit ? 'hit' : 'miss'} key="${cacheKey}"`);
  return value;
}

/** The uncached search: routing + fallback chain. */
async function runSearch(input: JobSearchInput, mode: JobSourceMode, costBucket?: CostBucket): Promise<JobSearchResult> {
  const now = new Date();
  const route = routeLocation(input.location, mode);

  // Legacy Exa path (flag=exa, or a location outside Adzuna/Reed coverage in hybrid).
  if (route.kind === 'exa') {
    if (mode === 'adzuna_reed') {
      // Strict mode: no Exa fallback and no covered source → clean empty state.
      return { jobs: [], error: JOBS_UNAVAILABLE_ERROR };
    }
    return runExa(input, costBucket);
  }

  // Primary structured source (Adzuna/Reed).
  try {
    const primary =
      route.kind === 'uk'
        ? await fetchUk(input, now, costBucket)
        : await fetchAdzuna(route.country ?? 'gb', input, costBucket);

    if (primary && primary.length > 0) {
      const jobs = finalizeJobs(applyFreshness(primary, { now }));
      if (jobs.length > 0) {
        console.log(`[job-search] source=${route.kind} country=${route.country ?? '-'} jobs=${jobs.length}`);
        return { jobs, error: null };
      }
    }
    // Primary returned nothing usable → fall through to Exa (unless strict).
    console.warn(`[job-search] primary source=${route.kind} returned no usable jobs — falling back`);
  } catch (err) {
    logSourceError(route.kind, err);
  }

  if (mode === 'adzuna_reed') {
    return { jobs: [], error: JOBS_UNAVAILABLE_ERROR };
  }
  return runExa(input, costBucket);
}

/** Exa call wrapped so an Exa outage becomes the AAT-10 state rather than a throw. */
async function runExa(input: JobSearchInput, costBucket?: CostBucket): Promise<JobSearchResult> {
  try {
    const jobs = await searchExa(input, costBucket);
    console.log(`[job-search] source=exa jobs=${jobs.length}`);
    // A genuine zero-result Exa search is NOT an error — error stays null (AAT-10 rule).
    return { jobs, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[job-search] Exa job search failed:', message);
    return { jobs: [], error: JOBS_UNAVAILABLE_ERROR };
  }
}

// ---------------------------------------------------------------------------
// Logging (cost hooks wired in JS-6)
// ---------------------------------------------------------------------------

function logSourceCall(costBucket: CostBucket | undefined, source: 'adzuna' | 'reed', count: number): void {
  // One API call per fetch; count is the number of results returned (for observability).
  if (source === 'adzuna') costBucket?.adzuna(`${source}.search (${count} results)`, 1);
  else costBucket?.reed(`${source}.search (${count} results)`, 1);
}

function logSourceError(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[job-search] source=${source} failed: ${message}`);
}
