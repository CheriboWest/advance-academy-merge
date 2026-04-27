import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { rewriteBulletWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  try {
    const authToken = getProxyAuthToken(request)
    const payload = await request.json()
    const response = await rewriteBulletWithBackend(payload, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }

    return NextResponse.json(
      {
        code: 'REWRITE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to rewrite bullet.',
      },
      { status: 500 },
    )
  }
}
