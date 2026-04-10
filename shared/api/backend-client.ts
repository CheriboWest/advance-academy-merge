import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
} from '@advance-academy/contracts'
import type { DreamCompanyInput, DreamCompanyResult } from '@/types/dream-company'
import type {
  EnrichmentRequest,
  EnrichmentResponse,
  OutreachRequest,
  OutreachResult,
} from '@/types/outreach'
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

export function parseCvOptimizerFileWithBackend(formData: FormData) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson<{ text: string }>(`${backendUrl}/api/cv-optimizer/parse-file`, formData, { timeoutMs: 60000 })
}

export function generateRewrittenCvWithBackend(formData: FormData): Promise<Response> {
  const { backendUrl } = getServerEnv()

  return fetch(`${backendUrl}/api/cv-optimizer/generate-rewritten-cv`, {
    method: 'POST',
    body: formData,
  })
}

export function generateOutreachWithBackend(payload: OutreachRequest) {
  const { backendUrl } = getServerEnv()

  return fetchJson<OutreachResult>(`${backendUrl}/api/outreach/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  })
}

export function extractOutreachTextWithBackend(payload: { url: string }) {
  const { backendUrl } = getServerEnv()

  return fetchJson<{ text: string }>(`${backendUrl}/api/outreach/extract`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  })
}

export interface ExtractedJob {
  jobTitle: string
  jobDescription: string
  companyName: string
  companyUrl: string
  extraLinks: string
}

export function extractJobFromUrlWithBackend(payload: { url: string }) {
  const { backendUrl } = getServerEnv()

  return fetchJson<ExtractedJob>(`${backendUrl}/api/interview-prep/extract-job-from-url`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 90000,
  })
}

export function extractOutreachFileWithBackend(formData: FormData) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson<{ text: string }>(`${backendUrl}/api/outreach/extract`, formData, { timeoutMs: 120000 })
}

// ── CV Library + Coach Answer ────────────────────────────────────────────────

export interface CvVersionSummary {
  id: string
  name: string
  detectedField: 'tech' | 'business' | 'marketing' | null
  isActive: boolean
  bulletCount: number
  openGapCount: number
  createdAt: string
}

export interface BulletWithGaps {
  id: string
  sectionPath: string | null
  bulletText: string
  ordinal: number
  gaps: Array<{
    id: string
    question: string
    rationale: string | null
    ordinal: number
    status: 'open' | 'answered' | 'skipped'
    artifacts: Array<{
      id: string
      sourceType: 'text' | 'file' | 'url' | 'jit_clarification'
      contentText: string | null
      sourceUrl: string | null
      summary: unknown
      createdAt: string
    }>
  }>
}

export interface MissingEvidencePrompt {
  bulletId: string | null
  bulletText: string | null
  question: string
}

export interface CoachAnswerResponse {
  critique: string
  improvedAnswer: string
  missingEvidencePrompts: MissingEvidencePrompt[]
}

export function listCvVersionsWithBackend() {
  const { backendUrl } = getServerEnv()
  return fetchJson<CvVersionSummary[]>(`${backendUrl}/api/cv-library/versions`, {
    method: 'GET',
    timeoutMs: 15000,
  })
}

export function uploadCvFileWithBackend(formData: FormData) {
  const { backendUrl } = getServerEnv()
  return fetchFormDataJson<{ cvVersionId: string; bulletCount: number; gapCount: number }>(
    `${backendUrl}/api/cv-library/versions`,
    formData,
    { timeoutMs: 300000 },
  )
}

export function activateCvVersionWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/versions/${id}/activate`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 10000,
  })
}

export function getCvVersionWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{
    id: string
    name: string
    rawText: string
    detectedField: 'tech' | 'business' | 'marketing' | null
    isActive: boolean
  }>(`${backendUrl}/api/cv-library/versions/${id}`, {
    method: 'GET',
    timeoutMs: 15000,
  })
}

export function deleteCvVersionWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/versions/${id}`, {
    method: 'DELETE',
    timeoutMs: 10000,
  })
}

export function getCvBulletsWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<BulletWithGaps[]>(`${backendUrl}/api/cv-library/versions/${id}/bullets`, {
    method: 'GET',
    timeoutMs: 30000,
  })
}

export function addGapArtifactWithBackend(gapId: string, payload: { text?: string; url?: string }) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/gaps/${gapId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 90000,
  })
}

export function addGapArtifactFileWithBackend(gapId: string, formData: FormData) {
  const { backendUrl } = getServerEnv()
  return fetchFormDataJson<{ ok: true }>(
    `${backendUrl}/api/cv-library/gaps/${gapId}/artifacts`,
    formData,
    { timeoutMs: 120000 },
  )
}

export function finalizeCvVersionWithBackend(id: string, payload: unknown) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/cv-library/versions/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 300000,
  })
}

export function findSimilarBulletsWithBackend(bulletId: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown[]>(`${backendUrl}/api/cv-library/bullets/${bulletId}/similar`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 30000,
  })
}

export function mergeBulletsWithBackend(payload: { sourceBulletId: string; targetBulletId: string }) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/bullets/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  })
}

export function backfillEmbeddingsWithBackend() {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ updated: number }>(`${backendUrl}/api/cv-library/backfill-embeddings`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 300000,
  })
}

export function skipGapWithBackend(gapId: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/gaps/${gapId}/skip`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 10000,
  })
}

export function jitClarificationWithBackend(payload: {
  bulletId: string | null
  question: string
  answer: string
}) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/jit-clarification`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  })
}

// ── Interview prep (start/message/evaluate/sessions) ────────────────────────

export function postInterviewWithBackend(payload: unknown) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/interview`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  })
}

export function evaluateInterviewWithBackend(payload: unknown) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/evaluate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 90000,
  })
}

export function listInterviewSessionsWithBackend() {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ sessions: unknown[] }>(`${backendUrl}/api/interview/sessions`, {
    method: 'GET',
    timeoutMs: 15000,
  })
}

export function getInterviewSessionWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ session: unknown }>(`${backendUrl}/api/interview/sessions/${id}`, {
    method: 'GET',
    timeoutMs: 15000,
  })
}

// ── Coach Understanding Reports ──────────────────────────────────────────────

export function generateCoachUnderstandingWithBackend() {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ reportId: string; reportMd: string }>(`${backendUrl}/api/coach-understanding/generate`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 120000,
  })
}

export function listCoachReportsWithBackend() {
  const { backendUrl } = getServerEnv()
  return fetchJson<Array<{ id: string; createdAt: string; preview: string }>>(
    `${backendUrl}/api/coach-understanding/reports`,
    { method: 'GET', timeoutMs: 15000 },
  )
}

export function getCoachReportWithBackend(id: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ id: string; reportMd: string; createdAt: string }>(
    `${backendUrl}/api/coach-understanding/reports/${id}`,
    { method: 'GET', timeoutMs: 15000 },
  )
}

export function coachAnswerWithBackend(payload: {
  question: string
  answer: string
  context: { jobTitle: string; jobDescription: string; companyName: string }
  cvVersionId?: string
  irsScore?: { integrity: number; relevance: number; substance: number; overall: number }
}) {
  const { backendUrl } = getServerEnv()
  return fetchJson<CoachAnswerResponse>(`${backendUrl}/api/interview/coach-answer`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 90000,
  })
}

export function enrichOutreachWithBackend(payload: EnrichmentRequest) {
  const { backendUrl } = getServerEnv()

  return fetchJson<EnrichmentResponse>(`${backendUrl}/api/outreach/enrich`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  })
}
