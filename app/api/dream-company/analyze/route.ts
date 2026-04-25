import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import type { DreamCompanyInput } from '@/types/dream-company'
import { analyzeProfileWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

function isAnalyzePayload(body: unknown): body is { profile: DreamCompanyInput } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'profile' in body &&
    typeof (body as { profile: unknown }).profile === 'object' &&
    (body as { profile: DreamCompanyInput }).profile !== null
  )
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json()
    if (!isAnalyzePayload(json)) {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Request body must include a profile object.' },
        { status: 400 },
      )
    }

    const response = await analyzeProfileWithBackend(json)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }

    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid request body.',
      },
      { status: 400 },
    )
  }
}
