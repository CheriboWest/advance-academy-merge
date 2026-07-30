import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getAdminUsersFromBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

// Admin user list (sprint F4). Thin proxy: forward the caller's bearer token to
// the backend, which enforces the admin gate. A 403 passes straight through so
// the page can render "admin access required".
export async function GET(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    const params = new URL(request.url).searchParams
    const limitRaw = params.get('limit')
    const response = await getAdminUsersFromBackend(
      {
        search: params.get('search') ?? undefined,
        tier: params.get('tier') ?? undefined,
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
      { code: 'INTERNAL_ERROR', message: 'Failed to load users.' },
      { status: 500 },
    )
  }
}
