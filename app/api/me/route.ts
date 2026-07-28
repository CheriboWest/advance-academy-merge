import { NextResponse } from 'next/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { getMeWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    return NextResponse.json(await getMeWithBackend(authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ code: 'UNKNOWN', message: 'Could not load account.' }, { status: 500 })
  }
}
