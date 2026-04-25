import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getInterviewSessionWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { id } = await params
    return NextResponse.json(await getInterviewSessionWithBackend(id, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
}
