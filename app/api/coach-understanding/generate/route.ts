import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { generateCoachUnderstandingWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  const authToken = getProxyAuthToken(request)
  const body = (await request.json().catch(() => ({}))) as { cvVersionId?: string }
  try {
    return NextResponse.json(await generateCoachUnderstandingWithBackend(body?.cvVersionId, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
