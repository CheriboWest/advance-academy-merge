import { NextResponse } from 'next/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { reviewUserWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

interface RouteContext {
  params: Promise<{
    userId: string
  }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authToken = getProxyAuthToken(request)
    const { userId } = await context.params
    const body = (await request.json()) as { status?: unknown }

    if (body?.status !== 'approved' && body?.status !== 'rejected') {
      return NextResponse.json(
        { code: 'BAD_REQUEST', message: 'status must be "approved" or "rejected".' },
        { status: 400 },
      )
    }

    return NextResponse.json(await reviewUserWithBackend(userId, body.status, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }

    return NextResponse.json(
      {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error.',
      },
      { status: 500 },
    )
  }
}
