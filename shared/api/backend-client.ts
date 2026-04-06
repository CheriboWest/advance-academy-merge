import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
} from '@advance-academy/contracts'
import type { DreamCompanyInput, DreamCompanyResult } from '@/types/dream-company'
import type { OutreachRequest, OutreachResult } from '@/types/outreach'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'
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

export function generateDreamCompaniesWithBackend(payload: { profile: DreamCompanyInput }) {
  const { backendUrl } = getServerEnv()

  return fetchJson<DreamCompanyResult>(`${backendUrl}/api/dream-company/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 120000,
  })
}

export function parseDreamCompanyCvWithBackend(formData: FormData) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson(`${backendUrl}/api/dream-company/parse-cv`, formData, { timeoutMs: 120000 })
}

export function generateOutreachWithBackend(payload: OutreachRequest) {
  const { backendUrl } = getServerEnv()

  return fetchJson<OutreachResult>(`${backendUrl}/api/outreach/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  })
}
