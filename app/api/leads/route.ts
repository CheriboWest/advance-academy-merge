import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getLeadsFromBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

// Admin lead list (CA-001, Bước 6). Thin proxy: forward the caller's bearer token
// to the backend, which enforces the ADMIN_USER_IDS allowlist. A 403 from the
// backend is passed straight through so the page can show "admin access required".
export async function GET(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    const params = new URL(request.url).searchParams
    const limitRaw = params.get('limit')
    const response = await getLeadsFromBackend(
      {
        status: params.get('status') ?? undefined,
        source: params.get('source') ?? undefined,
        limit: limitRaw ? Number(limitRaw) : undefined,
      },
      authToken,
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to load leads.' },
      { status: 500 },
    )
  }
}
