import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { validateJdWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json()
    if (typeof json !== 'object' || json === null || typeof (json as Record<string, unknown>).url !== 'string') {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Missing url field.' },
        { status: 400 },
      )
    }
    const response = await validateJdWithBackend({ url: (json as { url: string }).url })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Validation failed.',
      },
      { status: 400 },
    )
  }
}
