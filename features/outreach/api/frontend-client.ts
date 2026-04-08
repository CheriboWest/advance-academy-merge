import { fetchJson } from '@/shared/api/http-client'
import type {
  EnrichmentRequest,
  EnrichmentResponse,
  OutreachRequest,
  OutreachResult,
} from '@/types/outreach'

export async function submitOutreachGeneration(request: OutreachRequest): Promise<OutreachResult> {
  return fetchJson<OutreachResult>('/api/outreach/generate', {
    method: 'POST',
    body: JSON.stringify(request)
  })
}

export async function submitOutreachEnrichment(request: EnrichmentRequest): Promise<EnrichmentResponse> {
  return fetchJson<EnrichmentResponse>('/api/outreach/enrich', {
    method: 'POST',
    body: JSON.stringify(request)
  })
}

export async function extractOutreachSource(source: File | string): Promise<{ text: string }> {
  if (source instanceof File) {
    const formData = new FormData()
    formData.append('file', source)

    // Using native fetch for multipart
    const res = await fetch('/api/outreach/extract', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to extract text from file');
    }

    return res.json()
  } else {
    // URL
    return fetchJson<{ text: string }>('/api/outreach/extract', {
      method: 'POST',
      body: JSON.stringify({ url: source })
    })
  }
}
