import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// Tool run history (sprint F5). Thin proxy: forward the caller's bearer token to
// the backend, which scopes every row to request.userId.
export async function GET(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const params = new URL(request.url).searchParams
    const qs = new URLSearchParams()
    const tool = params.get('tool')
    const limit = params.get('limit')
    if (tool) qs.set('tool', tool)
    if (limit) qs.set('limit', limit)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''

    const res = await fetch(`${backendUrl}/api/tool-results${suffix}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'HISTORY_FAILED', message: 'Could not load your history.' },
      { status: 502 },
    )
  }
}
