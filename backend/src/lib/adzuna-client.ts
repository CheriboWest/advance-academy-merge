/**
 * Adzuna job-search client (live vacancies).
 *
 * Docs: https://developer.adzuna.com/  ·  GET /v1/api/jobs/{country}/search/{page}
 * Auth is via `app_id` + `app_key` query params. Retry (429/5xx ×3 backoff) and the
 * per-source timeout are provided by fetchJobJson (lib/job-http). We intentionally do
 * NOT send `max_days_old` — the work order (D2) found it collapses results to zero;
 * freshness is enforced downstream in the orchestrator instead. We sort by date so the
 * newest vacancies come first.
 */
import { fetchJobJson } from './job-http.js';

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';

/** Shape of a single Adzuna result (only the fields we consume). */
export interface AdzunaResult {
  title?: string;
  redirect_url?: string;
  /** ISO 8601 timestamp, e.g. "2026-06-30T12:00:00Z". */
  created?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  company?: { display_name?: string };
}

export interface AdzunaResponse {
  results: AdzunaResult[];
  count?: number;
}

export interface SearchAdzunaParams {
  /** Adzuna country code, e.g. "gb", "us", "au". */
  country: string;
  /** Keyword query (role titles). */
  what: string;
  /** Location filter, e.g. "London". Optional. */
  where?: string;
  page?: number;
  resultsPerPage?: number;
  sortBy?: 'date' | 'relevance' | 'salary';
  /**
   * When true, `what` is sent as Adzuna's `title_only` parameter so the keywords must
   * appear in the job TITLE (not just anywhere in the ad). Verified empirically to strip
   * off-topic matches at the source (e.g. "Head of Trading" for a "Data Analyst" query).
   */
  titleOnly?: boolean;
  /**
   * Search radius in km around `where` (Adzuna's `distance`). Only sent when > 0 AND a
   * `where` is present — a radius with no anchor location is meaningless.
   */
  distanceKm?: number;
}

/** Returns `{ appId, appKey }` or throws a 503 when either credential is missing. */
function getAdzunaCreds(): { appId: string; appKey: string } {
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();
  if (!appId || !appKey) {
    const err = new Error(
      'ADZUNA_APP_ID / ADZUNA_APP_KEY are not set in the backend environment. ' +
        'Add them to backend/.env (see backend/.env.example).',
    );
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
  return { appId, appKey };
}

/**
 * Search Adzuna for live vacancies. Throws a 503 (missing creds) or a JobHttpError
 * (network / non-2xx after retries). Callers in the orchestrator catch and fall back.
 */
export async function searchAdzuna(params: SearchAdzunaParams): Promise<AdzunaResult[]> {
  const { appId, appKey } = getAdzunaCreds();
  const {
    country,
    what,
    where,
    page = 1,
    resultsPerPage = 15,
    sortBy = 'date',
    titleOnly = false,
    distanceKm = 0,
  } = params;

  const query = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(resultsPerPage),
    sort_by: sortBy,
    'content-type': 'application/json',
  });
  // `title_only` restricts the keyword match to the job title; otherwise `what` matches
  // anywhere in the ad. They are mutually exclusive — send exactly one.
  if (titleOnly) query.set('title_only', what);
  else query.set('what', what);
  if (where) query.set('where', where);
  // Radius only makes sense with an anchor location.
  if (where && distanceKm > 0) query.set('distance', String(distanceKm));

  const url = `${ADZUNA_BASE}/${encodeURIComponent(country)}/search/${page}?${query.toString()}`;
  const data = await fetchJobJson<AdzunaResponse>(url, { source: 'adzuna' });
  return Array.isArray(data.results) ? data.results : [];
}
