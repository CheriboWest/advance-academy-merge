import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// Account summary (tier, credits, isAdmin). Thin proxy: forward the caller's
// bearer token to the backend, which reads request.userId. Drives the header's
// credit pill and the Admin link.
export async function GET(request: Request) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const res = await fetch(`${backendUrl}/api/account/me`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'ACCOUNT_FAILED', message: 'Could not load your account.' },
      { status: 502 },
    )
  }
}
