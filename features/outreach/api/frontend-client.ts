'use client'

import type { OutreachRequest, OutreachResult } from '@/types/outreach'
import { fetchJson } from '@/shared/api/http-client'

export function submitOutreachGeneration(payload: OutreachRequest) {
  return fetchJson<OutreachResult>('/api/outreach/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  })
}
