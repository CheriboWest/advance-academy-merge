import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { listInterviewSessionsWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
    return NextResponse.json(await listInterviewSessionsWithBackend(authToken, cursor))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ sessions: [], nextCursor: null })
  }
}
