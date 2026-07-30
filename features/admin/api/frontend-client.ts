'use client'

import { fetchJson } from '@/shared/api/http-client'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'
import type { LeadsFilters, LeadsListResponse } from '@/types/leads'

// Admin lead list (CA-001, Bước 6). Calls the Next.js proxy, which forwards the
// Supabase bearer token to the backend. Backend enforces the ADMIN_USER_IDS gate.
export async function listLeads(filters: LeadsFilters = {}): Promise<LeadsListResponse> {
  const qs = new URLSearchParams()
  if (filters.status) qs.set('status', filters.status)
  if (filters.source) qs.set('source', filters.source)
  if (filters.utmSource) qs.set('utm_source', filters.utmSource)
  if (filters.limit) qs.set('limit', String(filters.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''

  return fetchJson<LeadsListResponse>(`/api/leads${suffix}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
    timeoutMs: 15000,
  })
}
