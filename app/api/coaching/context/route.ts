import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// Coaching context picker (ticket T2). Thin proxy: forward the caller's bearer
// token. `studentId` is passed straight through — the backend is what decides
// whether this caller is allowed to read someone else's context, and duplicating
// that check here would only create a second place for it to drift.
export async function GET(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)

  try {
    const studentId = new URL(request.url).searchParams.get('studentId')
    const suffix = studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''

    const res = await fetch(`${backendUrl}/api/coaching/context${suffix}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'CONTEXT_FAILED', message: 'Could not load your context.' },
      { status: 502 },
    )
  }
}
