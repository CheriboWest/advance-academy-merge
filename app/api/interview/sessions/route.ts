import { NextResponse } from 'next/server'
import { listInterviewSessionsWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET() {
  try {
    return NextResponse.json(await listInterviewSessionsWithBackend())
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ sessions: [] })
  }
}
