'use client'

import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
  RewriteSuggestion,
} from '@advance-academy/contracts'
import { fetchFormDataJson, fetchJson, HttpClientError } from '@/shared/api/http-client'

export function submitCvAnalysis(payload: AnalyzeCvRequest) {
  return fetchJson<AnalyzeCvAcceptedResponse>('/api/cv-optimizer/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  })
}

export function getCvAnalysisJob(jobId: string) {
  return fetchJson<JobStatusResponse<AnalyzeCvResult>>(`/api/cv-optimizer/jobs/${jobId}`, {
    method: 'GET',
    timeoutMs: 10000,
  })
}

export function parseFileForCvOptimizer(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  return fetchFormDataJson<{ text: string }>('/api/cv-optimizer/parse-cv', formData, { timeoutMs: 60000 })
}

export interface GenerateRewrittenCvResult {
  blob: Blob
  filename: string
  appliedCount: number
  totalCount: number
}

export async function generateRewrittenCv(
  file: File,
  suggestions: RewriteSuggestion[],
): Promise<GenerateRewrittenCvResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('suggestions', JSON.stringify(suggestions))

  const response = await fetch('/api/cv-optimizer/generate-rewritten-cv', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let payload: { code?: string; message?: string } = {}
    try {
      payload = await response.json()
    } catch {
      // ignore parse errors
    }
    throw new HttpClientError(response.status, {
      code: payload.code ?? 'REWRITE_FAILED',
      message: payload.message ?? 'Failed to generate rewritten CV.',
    })
  }

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const filename = match ? decodeURIComponent(match[1]) : `${file.name.replace(/\.(docx|pdf)$/i, '')}-improved.docx`
  const appliedCount = Number(response.headers.get('x-rewrites-applied') ?? '0')
  const totalCount = Number(response.headers.get('x-rewrites-total') ?? '0')

  return { blob, filename, appliedCount, totalCount }
}
