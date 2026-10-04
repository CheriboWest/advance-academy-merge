import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

// A company's contacts for a Membership student. Thin proxy, like account/me:
// the backend does the auth, approval and membership checks and answers 403
// MEMBERSHIP_REQUIRED for trial accounts, which the page shows as the upgrade prompt.
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const res = await fetch(`${backendUrl}/api/company-contacts/${encodeURIComponent(companyId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ code: 'CONTACTS_FAILED', message: 'Could not load contacts.' }, { status: 502 })
  }
}
