import { NextResponse } from 'next/server'
import { extractJobFromUrlWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const url = typeof json?.url === 'string' ? json.url.trim() : ''
    if (!url) {
      return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 })
    }

    const response = await extractJobFromUrlWithBackend({ url })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid request.',
      },
      { status: 400 },
    )
  }
}
