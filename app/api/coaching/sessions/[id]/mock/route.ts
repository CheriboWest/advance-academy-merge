import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// The Interview Lab context for an approved pack (ticket T7). The backend gates
// it on approval and on the caller owning the session.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/coaching/sessions/${encodeURIComponent(id)}/mock`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'MOCK_FAILED', message: 'Could not set up a mock for this session.' },
      { status: 502 },
    )
  }
}
