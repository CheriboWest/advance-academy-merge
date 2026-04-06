const DEFAULT_BACKEND_URL = 'http://localhost:4000'

export function getServerEnv() {
  return {
    backendUrl: process.env.BACKEND_URL?.trim() || DEFAULT_BACKEND_URL,
  }
}
