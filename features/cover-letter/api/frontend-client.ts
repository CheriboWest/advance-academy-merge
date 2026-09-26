'use client'

import { fetchJson } from '@/shared/api/http-client'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'
import type {
  GenerateCoverLetterRequest,
  GenerateCoverLetterResponse,
} from '@advance-academy/contracts/cover-letter'

export async function generateCoverLetter(body: GenerateCoverLetterRequest): Promise<GenerateCoverLetterResponse> {
  return fetchJson<GenerateCoverLetterResponse>('/api/cover-letter/generate', {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
    timeoutMs: 120000,
  })
}
