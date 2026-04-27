import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { extractOutreachTextWithBackend, extractOutreachFileWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  const authToken = getProxyAuthToken(request)
  try {
    const contentType = request.headers.get('content-type') || '';

    let response;
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      response = await extractOutreachFileWithBackend(formData, authToken)
    } else {
      const json = await request.json()
      response = await extractOutreachTextWithBackend(json, authToken)
    }

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
