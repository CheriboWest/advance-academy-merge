import { NextResponse } from 'next/server'
import type { DreamCompanyInput, ProfileAnalysis, TargetRole } from '@/types/dream-company'
import { generateRoadmapWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

function isRoadmapPayload(
  body: unknown,
): body is { profile: DreamCompanyInput; analysis: ProfileAnalysis; selectedRoles: TargetRole[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'profile' in body &&
    typeof (body as { profile: unknown }).profile === 'object' &&
    'analysis' in body &&
    typeof (body as { analysis: unknown }).analysis === 'object' &&
    'selectedRoles' in body &&
    Array.isArray((body as { selectedRoles: unknown }).selectedRoles)
  )
}

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json()
    if (!isRoadmapPayload(json)) {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Request body must include profile, analysis, and selectedRoles array.' },
        { status: 400 },
      )
    }

    const response = await generateRoadmapWithBackend(json)
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
