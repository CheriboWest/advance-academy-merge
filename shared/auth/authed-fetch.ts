import { getAuthHeaders } from './get-auth-headers'

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders()
  return fetch(input, {
    ...init,
    headers: { ...authHeaders, ...(init.headers as Record<string, string> ?? {}) },
  })
}
