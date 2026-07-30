import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// One stored tool run. The backend scopes the lookup to the caller's user id, so
// an id belonging to someone else simply comes back as 404.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/tool-results/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'HISTORY_FAILED', message: 'Could not load that result.' },
      { status: 502 },
    )
  }
}
