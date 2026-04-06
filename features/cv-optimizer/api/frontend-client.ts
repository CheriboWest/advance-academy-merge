'use client'

import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
} from '@advance-academy/contracts'
import { fetchJson } from '@/shared/api/http-client'

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
