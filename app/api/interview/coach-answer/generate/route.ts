import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { coachAnswerGenerateWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    const body = await request.json()
    return NextResponse.json(await coachAnswerGenerateWithBackend(body, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 400 },
    )
  }
}
