'use client'

import { fetchJson } from '@/shared/api/http-client'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'
import type {
  EngagementResponse,
  UpdateEngagementSettingsRequest,
} from '@advance-academy/contracts/engagement'

export async function getEngagement(): Promise<EngagementResponse> {
  return fetchJson<EngagementResponse>('/api/engagement', {
    method: 'GET',
    headers: await getAuthHeaders(),
    timeoutMs: 15000,
  })
}

export async function updateEngagementSettings(body: UpdateEngagementSettingsRequest): Promise<{ emailReminders: boolean }> {
  return fetchJson<{ emailReminders: boolean }>('/api/engagement', {
    method: 'PATCH',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
    timeoutMs: 15000,
  })
}
