import { NextResponse } from 'next/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { listUsersWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(request: Request) {
  const authToken = getProxyAuthToken(request)
  const status = new URL(request.url).searchParams.get('status') ?? undefined
  try {
    return NextResponse.json(await listUsersWithBackend(status, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ code: 'UNKNOWN', message: 'Could not load users.' }, { status: 500 })
  }
}
