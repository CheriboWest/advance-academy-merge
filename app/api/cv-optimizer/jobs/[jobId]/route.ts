import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getCvAnalysisJobFromBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

interface RouteContext {
  params: Promise<{
    jobId: string
  }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const authToken = getProxyAuthToken(request)
    const { jobId } = await context.params
    const response = await getCvAnalysisJobFromBackend(jobId, authToken)

    return NextResponse.json(response)
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
