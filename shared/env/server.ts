const DEFAULT_BACKEND_URL = 'http://localhost:4000'

export function getServerEnv() {
  // Strip any trailing slash(es) so callers can safely append `/api/...` without
  // producing a double slash. A trailing slash in the BACKEND_URL env var made
  // every request hit `//api/...`, which Fastify treats as a different (missing)
  // route and answers with "Route POST://api/... not found".
  const backendUrl = (process.env.BACKEND_URL?.trim() || DEFAULT_BACKEND_URL).replace(/\/+$/, '')

  return { backendUrl }
}
