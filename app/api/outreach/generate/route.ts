import { NextResponse } from 'next/server'
import type { OutreachRequest } from '@/types/outreach'
import { generateOutreachWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

function isOutreachRequest(body: unknown): body is OutreachRequest {
  if (typeof body !== 'object' || body === null) return false
  const o = body as Record<string, unknown>
  return (
    typeof o.intent === 'string' &&
    typeof o.cvText === 'string' &&
    typeof o.targetCompany === 'string' &&
    typeof o.targetPersonName === 'string'
  )
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json()
    if (!isOutreachRequest(json)) {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Request body must match outreach payload shape.' },
        { status: 400 },
      )
    }

    const response = await generateOutreachWithBackend(json)
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
