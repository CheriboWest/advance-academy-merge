'use client'

import { fetchJson } from '@/shared/api/http-client'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'
import type {
  ChangeJobStatusRequest,
  CreateSavedJobRequest,
  SavedJobDetailResponse,
  SavedJobListResponse,
  SavedJobResponse,
  UpdateSavedJobRequest,
} from '@advance-academy/contracts/job-tracking'

// Job tracker (AI Job Tools 1.3). Calls the Next.js proxy, which forwards the
// Supabase bearer token; the backend scopes every row to the signed-in user.
// Every call is a plain Postgres read/write — 15s is generous.
const TIMEOUT_MS = 15000
const BASE = '/api/job-tracking'

async function authed(): Promise<Record<string, string>> {
  return getAuthHeaders()
}

export async function listSavedJobs(): Promise<SavedJobListResponse> {
  return fetchJson<SavedJobListResponse>(BASE, {
    method: 'GET',
    headers: await authed(),
    timeoutMs: TIMEOUT_MS,
  })
}

export async function getSavedJob(id: string): Promise<SavedJobDetailResponse> {
  return fetchJson<SavedJobDetailResponse>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: await authed(),
    timeoutMs: TIMEOUT_MS,
  })
}

/** Throws `HttpClientError` with status 409 and code `JOB_ALREADY_SAVED` when the link is already tracked. */
export async function createSavedJob(body: CreateSavedJobRequest): Promise<SavedJobResponse> {
  return fetchJson<SavedJobResponse>(BASE, {
    method: 'POST',
    headers: await authed(),
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS,
  })
}

export async function updateSavedJob(id: string, body: UpdateSavedJobRequest): Promise<SavedJobResponse> {
  return fetchJson<SavedJobResponse>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await authed(),
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS,
  })
}

export async function changeSavedJobStatus(
  id: string,
  body: ChangeJobStatusRequest,
): Promise<SavedJobResponse> {
  return fetchJson<SavedJobResponse>(`${BASE}/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: await authed(),
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS,
  })
}

export async function deleteSavedJob(id: string): Promise<void> {
  await fetchJson<null>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authed(),
    timeoutMs: TIMEOUT_MS,
  })
}
