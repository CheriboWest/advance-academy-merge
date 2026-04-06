'use client'

import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
} from '@advance-academy/contracts'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'

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
