const DEFAULT_BACKEND_URL = 'http://localhost:4000'

export function getServerEnv() {
  const raw = process.env.BACKEND_URL?.trim() || DEFAULT_BACKEND_URL
  return {
    // Strip any trailing slash(es) so proxy paths don't become "//api/...".
    backendUrl: raw.replace(/\/+$/, ''),
  }
}
