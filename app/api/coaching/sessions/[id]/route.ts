import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// One coaching session. The backend scopes the lookup to the caller unless they
// are an admin, so someone else's id comes back as a plain 404.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/coaching/sessions/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'SESSION_FAILED', message: 'Could not load that session.' },
      { status: 502 },
    )
  }
}

// Coach edits: notes, extra pages to research, the confirmed slot (ticket T5).
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
    const res = await fetch(`${backendUrl}/api/coaching/sessions/${encodeURIComponent(id)}`, {
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
      { code: 'UPDATE_FAILED', message: 'Could not update the session.' },
      { status: 502 },
    )
  }
}
