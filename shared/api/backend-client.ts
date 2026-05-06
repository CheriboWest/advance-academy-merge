import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  JobStatusResponse,
  RewriteBulletRequest,
  RewriteBulletResponse,
} from '@advance-academy/contracts'
import type { DreamCompanyInput, ProfileAnalysis, TargetRole, RoadmapResponse } from '@/types/dream-company'
import type {
  EnrichmentRequest,
  EnrichmentResponse,
  JdValidationResult,
  OutreachRequest,
  OutreachResult,
} from '@/types/outreach'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'
import { getServerEnv } from '@/shared/env/server'

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function analyzeCvWithBackend(payload: AnalyzeCvRequest, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<AnalyzeCvAcceptedResponse>(`${backendUrl}/api/cv-optimizer/analyze`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function getCvAnalysisJobFromBackend(jobId: string, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<JobStatusResponse<AnalyzeCvResult>>(`${backendUrl}/api/cv-optimizer/jobs/${jobId}`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 10000,
  })
}

export function analyzeProfileWithBackend(payload: { profile: DreamCompanyInput }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<ProfileAnalysis>(`${backendUrl}/api/dream-company/analyze`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 60000,
  })
}

export function generateRolesWithBackend(payload: { profile: DreamCompanyInput; analysis: ProfileAnalysis }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<TargetRole[]>(`${backendUrl}/api/dream-company/roles`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 120000,
  })
}

export function generateRoadmapWithBackend(payload: { profile: DreamCompanyInput; analysis: ProfileAnalysis; selectedRoles: TargetRole[] }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<RoadmapResponse>(`${backendUrl}/api/dream-company/roadmap`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 180000,
  })
}

export function parseDreamCompanyCvWithBackend(formData: FormData, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson(`${backendUrl}/api/dream-company/parse-cv`, formData, { timeoutMs: 120000, headers: authHeaders(authToken) })
}

export function parseCvOptimizerFileWithBackend(formData: FormData, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson<{ text: string }>(`${backendUrl}/api/cv-optimizer/parse-file`, formData, { timeoutMs: 60000, headers: authHeaders(authToken) })
}

export function generateRewrittenCvWithBackend(formData: FormData, authToken?: string): Promise<Response> {
  const { backendUrl } = getServerEnv()

  return fetch(`${backendUrl}/api/cv-optimizer/generate-rewritten-cv`, {
    method: 'POST',
    body: formData,
    headers: authHeaders(authToken),
  })
}

export function rewriteBulletWithBackend(payload: RewriteBulletRequest, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<RewriteBulletResponse>(`${backendUrl}/api/cv-optimizer/rewrite-bullet`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function generateOutreachWithBackend(payload: OutreachRequest, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<OutreachResult>(`${backendUrl}/api/outreach/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 60000,
  })
}

export function extractOutreachTextWithBackend(payload: { url: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<{ text: string }>(`${backendUrl}/api/outreach/extract`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 60000,
  })
}

export interface ExtractedJob {
  jobTitle: string
  jobDescription: string
  companyName: string
  companyUrl: string
  extraLinks: string[]
}

export function extractJobFromUrlWithBackend(payload: { url: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<ExtractedJob>(`${backendUrl}/api/interview-prep/extract-job-from-url`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function extractOutreachFileWithBackend(formData: FormData, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchFormDataJson<{ text: string }>(`${backendUrl}/api/outreach/extract`, formData, { timeoutMs: 120000, headers: authHeaders(authToken) })
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

export function listCvVersionsWithBackend(authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<CvVersionSummary[]>(`${backendUrl}/api/cv-library/versions`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 15000,
  })
}

export function uploadCvFileWithBackend(formData: FormData, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchFormDataJson<{ cvVersionId: string; bulletCount: number; gapCount: number }>(
    `${backendUrl}/api/cv-library/versions`,
    formData,
    { timeoutMs: 300000, headers: authHeaders(authToken) },
  )
}

export function activateCvVersionWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/versions/${id}/activate`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: authHeaders(authToken),
    timeoutMs: 10000,
  })
}

export function getCvVersionWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{
    id: string
    name: string
    rawText: string
    detectedField: 'tech' | 'business' | 'marketing' | null
    isActive: boolean
  }>(`${backendUrl}/api/cv-library/versions/${id}`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 15000,
  })
}

export function deleteCvVersionWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/versions/${id}`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
    timeoutMs: 10000,
  })
}

export function getCvBulletsWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<BulletWithGaps[]>(`${backendUrl}/api/cv-library/versions/${id}/bullets`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function addGapArtifactWithBackend(gapId: string, payload: { text: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/gaps/${gapId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function updateArtifactWithBackend(artifactId: string, payload: { text: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/artifacts/${artifactId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function finalizeCvVersionWithBackend(id: string, payload: unknown, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/cv-library/versions/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 300000,
  })
}

export function findSimilarBulletsWithBackend(bulletId: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown[]>(`${backendUrl}/api/cv-library/bullets/${bulletId}/similar`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function mergeBulletsWithBackend(payload: { sourceBulletId: string; targetBulletId: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/bullets/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function backfillEmbeddingsWithBackend(authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ updated: number }>(`${backendUrl}/api/cv-library/backfill-embeddings`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: authHeaders(authToken),
    timeoutMs: 300000,
  })
}

export function skipGapWithBackend(gapId: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/gaps/${gapId}/skip`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: authHeaders(authToken),
    timeoutMs: 10000,
  })
}

export function jitClarificationWithBackend(payload: {
  bulletId: string | null
  question: string
  answer: string
}, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ ok: true }>(`${backendUrl}/api/cv-library/jit-clarification`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

// ── Interview prep (start/message/evaluate/sessions) ────────────────────────

export function postInterviewWithBackend(payload: unknown, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/interview`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 60000,
  })
}

export function evaluateInterviewWithBackend(payload: unknown, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<unknown>(`${backendUrl}/api/evaluate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function listInterviewSessionsWithBackend(authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ sessions: unknown[] }>(`${backendUrl}/api/interview/sessions`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 15000,
  })
}

export function getInterviewSessionWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ session: unknown }>(`${backendUrl}/api/interview/sessions/${id}`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 15000,
  })
}

export function transcribeInterviewAudioWithBackend(formData: FormData, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchFormDataJson<{ text: string }>(
    `${backendUrl}/api/interview/transcribe`,
    formData,
    { timeoutMs: 60000, headers: authHeaders(authToken) },
  )
}

// ── Coach Understanding Reports ──────────────────────────────────────────────

export function generateCoachUnderstandingWithBackend(authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ reportId: string; reportMd: string }>(`${backendUrl}/api/coach-understanding/generate`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: authHeaders(authToken),
    timeoutMs: 120000,
  })
}

export function listCoachReportsWithBackend(authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<Array<{ id: string; createdAt: string; preview: string }>>(
    `${backendUrl}/api/coach-understanding/reports`,
    { method: 'GET', headers: authHeaders(authToken), timeoutMs: 15000 },
  )
}

export function getCoachReportWithBackend(id: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<{ id: string; reportMd: string; createdAt: string }>(
    `${backendUrl}/api/coach-understanding/reports/${id}`,
    { method: 'GET', headers: authHeaders(authToken), timeoutMs: 15000 },
  )
}

// ── Coach answer (two-phase: preview → generate) ────────────────────────────

export interface CoachPreviewBullet {
  id: string
  bulletText: string
  sectionPath: string | null
  similarity: number
  gaps: Array<{
    id: string
    question: string
    status: 'open' | 'answered' | 'skipped'
    artifacts: Array<{
      id: string
      sourceType: 'text' | 'file' | 'url' | 'jit_clarification'
      contentText: string | null
      sourceUrl: string | null
      createdAt: string
    }>
  }>
}

export interface UserBulletSummaryDto {
  id: string
  bulletText: string
  sectionPath: string | null
  gapCount: number
  answeredGapCount: number
}

export interface CoachPreviewResponse {
  selectedBulletIds: string[]
  bullets: CoachPreviewBullet[]
  allBullets: UserBulletSummaryDto[]
  threshold: number
}

export function coachAnswerPreviewWithBackend(
  payload: { question: string },
  authToken?: string,
) {
  const { backendUrl } = getServerEnv()
  return fetchJson<CoachPreviewResponse>(`${backendUrl}/api/interview/coach-answer/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}

export function coachAnswerGenerateWithBackend(
  payload: {
    question: string
    answer: string
    context: { jobTitle: string; jobDescription: string; companyName: string }
    selectedBulletIds: string[]
    conversationHistory: Array<{ role: 'interviewer' | 'candidate'; content: string }>
    irsScore?: { integrity: number; relevance: number; substance: number; overall: number }
    assessmentId?: string
  },
  authToken?: string,
) {
  const { backendUrl } = getServerEnv()
  return fetchJson<CoachAnswerResponse>(`${backendUrl}/api/interview/coach-answer/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function getBulletDetailsWithBackend(bulletId: string, authToken?: string) {
  const { backendUrl } = getServerEnv()
  return fetchJson<BulletWithGaps>(`${backendUrl}/api/cv-library/bullets/${bulletId}/details`, {
    method: 'GET',
    headers: authHeaders(authToken),
    timeoutMs: 15000,
  })
}

export function enrichOutreachWithBackend(payload: EnrichmentRequest, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<EnrichmentResponse>(`${backendUrl}/api/outreach/enrich`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 90000,
  })
}

export function validateJdWithBackend(payload: { url: string }, authToken?: string) {
  const { backendUrl } = getServerEnv()

  return fetchJson<JdValidationResult>(`${backendUrl}/api/outreach/validate-jd`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authHeaders(authToken),
    timeoutMs: 30000,
  })
}
