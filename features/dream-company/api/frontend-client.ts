'use client'

import type { DreamCompanyInput, ProfileAnalysis, TargetRole, RoadmapResponse } from '@/types/dream-company'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'

export async function analyzeProfile(profile: DreamCompanyInput): Promise<ProfileAnalysis> {
  return fetchJson<ProfileAnalysis>('/api/dream-company/analyze', {
    method: 'POST',
    body: JSON.stringify({ profile }),
    headers: await getAuthHeaders(),
    timeoutMs: 60000,
  })
}

export async function generateRoles(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
): Promise<TargetRole[]> {
  return fetchJson<TargetRole[]>('/api/dream-company/roles', {
    method: 'POST',
    body: JSON.stringify({ profile, analysis }),
    headers: await getAuthHeaders(),
    timeoutMs: 60000,
  })
}

export async function generateRoadmap(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  selectedRoles: TargetRole[],
): Promise<RoadmapResponse> {
  return fetchJson<RoadmapResponse>('/api/dream-company/roadmap', {
    method: 'POST',
    body: JSON.stringify({ profile, analysis, selectedRoles }),
    headers: await getAuthHeaders(),
    timeoutMs: 180000,
  })
}

// ---- Streaming (SSE) variants (M2.1) --------------------------------------------------
// Same inputs/outputs as the JSON functions above, but consume the backend's SSE stream:
// `onDelta` fires with each text chunk (drive a progress bar), and the promise resolves with
// the final parsed result from the `done` event. See test/dream-company/M2.1-streaming-contract.md.

async function postSSE<T>(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  })

  // Bad input / auth errors come back as normal JSON (not an event stream) — surface them.
  if (!res.headers.get('content-type')?.includes('text/event-stream') || !res.body) {
    let message = `Request failed (${res.status})`
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      message = j.message || j.error || message
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: T | undefined
  let streamError: string | undefined

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = frame.match(/^event: (.*)$/m)?.[1]
      const data = frame.match(/^data: (.*)$/m)?.[1]
      if (!event || data == null) continue // skips ": keepalive" comment lines
      if (event === 'delta') {
        try {
          onDelta((JSON.parse(data) as { text?: string }).text ?? '')
        } catch {
          /* ignore malformed delta */
        }
      } else if (event === 'done') {
        result = JSON.parse(data) as T
      } else if (event === 'error') {
        try {
          streamError = (JSON.parse(data) as { message?: string }).message
        } catch {
          streamError = 'The analysis service failed. Please try again.'
        }
      }
    }
  }

  if (streamError) throw new Error(streamError)
  if (result === undefined) throw new Error('The connection ended before the result arrived. Please try again.')
  return result
}

export function analyzeProfileStream(
  profile: DreamCompanyInput,
  onDelta: (text: string) => void,
): Promise<ProfileAnalysis> {
  return postSSE<ProfileAnalysis>('/api/dream-company/analyze/stream', { profile }, onDelta)
}

export function generateRolesStream(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  onDelta: (text: string) => void,
): Promise<TargetRole[]> {
  return postSSE<TargetRole[]>('/api/dream-company/roles/stream', { profile, analysis }, onDelta)
}

export function generateRoadmapStream(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  selectedRoles: TargetRole[],
  onDelta: (text: string) => void,
): Promise<RoadmapResponse> {
  return postSSE<RoadmapResponse>(
    '/api/dream-company/roadmap/stream',
    { profile, analysis, selectedRoles },
    onDelta,
  )
}

export interface CVParseResponse {
  degree: string
  workExperience: string
  skills: string
  interests: string
  targetSalary: string
  location: string
  currentLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'manager' | 'director' | 'executive'
  confidence: {
    degree: 'high' | 'medium' | 'low'
    workExperience: 'high' | 'medium' | 'low'
    skills: 'high' | 'medium' | 'low'
    location: 'high' | 'medium' | 'low'
  }
}

export async function parseCV(file: File): Promise<CVParseResponse> {
  const formData = new FormData()
  formData.append('cv', file)

  return fetchFormDataJson<CVParseResponse>('/api/dream-company/parse-cv', formData, {
    timeoutMs: 120000,
    headers: await getAuthHeaders(),
  })
}
