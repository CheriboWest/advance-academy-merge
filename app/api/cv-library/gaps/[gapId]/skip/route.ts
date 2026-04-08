import { NextResponse } from 'next/server'
import { skipGapWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(_req: Request, { params }: { params: Promise<{ gapId: string }> }) {
  try {
    const { gapId } = await params
    return NextResponse.json(await skipGapWithBackend(gapId))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
