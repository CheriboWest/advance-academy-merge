import { NextResponse } from 'next/server'
import { parseDreamCompanyCvWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

export async function POST(request: Request) {
  try {
    const authToken = getProxyAuthToken(request)
    const formData = await request.formData()
    const response = await parseDreamCompanyCvWithBackend(formData, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }

    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid multipart body.',
      },
      { status: 400 },
    )
  }
}
