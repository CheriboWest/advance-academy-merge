import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// What came out of the coaching session (ticket T6.5). Admin-only, enforced on
// the backend. Separate from the session PATCH because notes are written after
// approval, which that route refuses to touch.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/coaching/sessions/${encodeURIComponent(id)}/notes`, {
      method: 'PATCH',
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
      { code: 'NOTES_FAILED', message: 'Could not save the notes.' },
      { status: 502 },
    )
  }
}
