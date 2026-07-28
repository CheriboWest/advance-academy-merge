import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'

// Passwordless magic-link request (CA-001, P2/2a). Thin proxy that keeps
// BACKEND_URL server-only. The backend endpoint is public (no bearer token) and
// always answers 200 for a valid email, so we forward the response as-is.
export async function POST(request: Request) {
  const { backendUrl } = getServerEnv()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY', message: 'Invalid request body.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${backendUrl}/api/auth/passwordless`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'PASSWORDLESS_FAILED', message: 'Could not send your login link. Please try again.' },
      { status: 502 },
    )
  }
}
