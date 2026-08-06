import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// Mock interviews run against one coaching pack (ticket T7).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(
      `${backendUrl}/api/coaching/sessions/${encodeURIComponent(id)}/practice`,
      {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(15000),
      },
    )
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'PRACTICE_FAILED', message: 'Could not load the practice runs.' },
      { status: 502 },
    )
  }
}
