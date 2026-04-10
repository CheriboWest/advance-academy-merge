import { NextResponse } from 'next/server'
import { generateCoachUnderstandingWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST() {
  try {
    return NextResponse.json(await generateCoachUnderstandingWithBackend())
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
