import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'

// Stop reminder emails. Two callers, no session in either:
//   - a mail provider's one-click unsubscribe (RFC 8058): POST to the
//     List-Unsubscribe URL, token in the query, form-encoded body we ignore;
//   - the /unsubscribe page: POST with { u, t } as JSON.
// The HMAC token is verified by the backend.
export async function POST(request: Request) {
  const { backendUrl } = getServerEnv()
  const url = new URL(request.url)
  let u = url.searchParams.get('u')
  let t = url.searchParams.get('t')
  if (!u || !t) {
    const body = (await request.json().catch(() => ({}))) as { u?: unknown; t?: unknown }
    u = typeof body.u === 'string' ? body.u : null
    t = typeof body.t === 'string' ? body.t : null
  }
  if (!u || !t) {
    return NextResponse.json({ code: 'INVALID_LINK', message: 'This unsubscribe link is not valid.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${backendUrl}/api/engagement/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u, t }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ code: 'UNSUBSCRIBE_FAILED', message: 'Could not reach the server.' }, { status: 502 })
  }
}
