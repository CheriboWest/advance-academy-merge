import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
} from '@advance-academy/contracts'
import { fetchJson } from '@/shared/api/http-client'
import { getServerEnv } from '@/shared/env/server'

export function analyzeCvWithBackend(payload: AnalyzeCvRequest) {
  const { backendUrl } = getServerEnv()

  return fetchJson<AnalyzeCvAcceptedResponse>(`${backendUrl}/api/cv-optimizer/analyze`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  })
}

export function getCvAnalysisJobFromBackend(jobId: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<JobStatusResponse<AnalyzeCvResult>>(`${backendUrl}/api/cv-optimizer/jobs/${jobId}`, {
    method: 'GET',
    timeoutMs: 10000,
  })
}
