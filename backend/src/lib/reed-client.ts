/**
 * Reed job-search client (live UK vacancies).
 *
 * Docs: https://www.reed.co.uk/developers/jobseeker  ·  GET /api/1.0/search
 * Auth is HTTP Basic where the API key is the username and the password is empty
 * (i.e. `Authorization: Basic base64("<REED_API_KEY>:")`). Retry (429/5xx ×3) and the
 * per-source timeout come from fetchJobJson (lib/job-http). Reed results carry an
 * `expirationDate` the orchestrator uses to drop already-closed vacancies.
 */
import { fetchJobJson } from './job-http.js';

const REED_BASE = 'https://www.reed.co.uk/api/1.0/search';

/** Shape of a single Reed result (only the fields we consume). */
export interface ReedResult {
  jobId?: number;
  jobTitle?: string;
  employerName?: string;
  jobUrl?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  jobDescription?: string;
  /** Posted date, DD/MM/YYYY. */
  date?: string;
  /** Expiry date, DD/MM/YYYY. */
  expirationDate?: string;
}

export interface ReedResponse {
  results: ReedResult[];
  totalResults?: number;
}

export interface SearchReedParams {
  keywords: string;
  locationName?: string;
  resultsToTake?: number;
  /**
   * Search radius in MILES around `locationName` (Reed's `distanceFromLocation`). Only
   * sent when > 0 AND a `locationName` is present. Callers hold radius in km, so convert
   * before passing (see job-search.service).
   */
  distanceFromLocationMiles?: number;
}

/** Returns the Reed API key or throws a 503 when it is missing. */
function getReedKey(): string {
  const key = process.env.REED_API_KEY?.trim();
  if (!key) {
    const err = new Error(
      'REED_API_KEY is not set in the backend environment. Add it to backend/.env (see backend/.env.example).',
    );
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
  return key;
}

/** Basic-auth header value: base64("<key>:"). */
function reedAuthHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

/**
 * Search Reed for live UK vacancies. Throws a 503 (missing key) or a JobHttpError
 * (network / non-2xx after retries). Callers in the orchestrator catch and fall back.
 */
export async function searchReed(params: SearchReedParams): Promise<ReedResult[]> {
  const key = getReedKey();
  const { keywords, locationName, resultsToTake = 15, distanceFromLocationMiles = 0 } = params;

  const query = new URLSearchParams({
    keywords,
    resultsToTake: String(resultsToTake),
  });
  if (locationName) query.set('locationName', locationName);
  // Radius only makes sense with an anchor location.
  if (locationName && distanceFromLocationMiles > 0) {
    query.set('distanceFromLocation', String(distanceFromLocationMiles));
  }

  const url = `${REED_BASE}?${query.toString()}`;
  const data = await fetchJobJson<ReedResponse>(url, {
    source: 'reed',
    headers: { Authorization: reedAuthHeader(key) },
  });
  return Array.isArray(data.results) ? data.results : [];
}
