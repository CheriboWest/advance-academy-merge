import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import type { CreateSavedJobRequest } from '@advance-academy/contracts/job-tracking'

// Job tracker (AI Job Tools 1.3). The proxy keeps BACKEND_URL server-side and
// forwards the bearer token; the backend validates fields and scopes every row
// to the signed-in user. Status codes pass through untouched (400/404/409).

/** Shape check only — the backend owns field rules and the 400 messages. */
function isCreateBody(value: unknown): value is CreateSavedJobRequest {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>).title === 'string'
}

export async function GET(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const res = await fetch(`${backendUrl}/api/job-tracking`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'LIST_FAILED', message: 'Could not load your jobs.' },
      { status: 502 },
    )
  }
}

export async function POST(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Invalid request body.' },
      { status: 400 },
    )
  }
  if (!isCreateBody(body)) {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'A job title is required.' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${backendUrl}/api/job-tracking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'SAVE_FAILED', message: 'Could not save that job.' },
      { status: 502 },
    )
  }
}
