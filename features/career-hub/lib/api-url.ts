/**
 * Where the coach pages reach career-hub's FastAPI service (backend-python).
 *
 * The browser goes through the same-origin rewrite in next.config.mjs, so the
 * Python URL never ships in the bundle and the API needs no CORS entry for
 * this app. Server code (Server Components, server actions) can't fetch a
 * relative URL, so it calls the API directly with careerHubApiUrl().
 */
export const CAREERHUB_PROXY = "/api/careerhub";

/** The Python API's base URL, server-side only; null when unconfigured. */
export function careerHubApiUrl(): string | null {
  return process.env.CAREERHUB_API_URL?.trim().replace(/\/+$/, "") || null;
}
