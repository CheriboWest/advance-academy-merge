import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import type { CreateCoachingSessionRequest } from '@advance-academy/contracts/coaching'

/** Shape check only. The backend owns the business rules and the 422 messages. */
function isBookingBody(value: unknown): value is CreateCoachingSessionRequest {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return typeof b.companyName === 'string' && typeof b.jdText === 'string'
}

export async function GET(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)

  try {
    const params = new URL(request.url).searchParams
    const qs = new URLSearchParams()
    for (const key of ['studentId', 'limit', 'scope']) {
      const value = params.get(key)
      if (value) qs.set(key, value)
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : ''

    const res = await fetch(`${backendUrl}/api/coaching/sessions${suffix}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'LIST_FAILED', message: 'Could not load your coaching sessions.' },
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

  if (!isBookingBody(body)) {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'A company and a job description are required.' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${backendUrl}/api/coaching/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'BOOKING_FAILED', message: 'Could not book the session.' },
      { status: 502 },
    )
  }
}
