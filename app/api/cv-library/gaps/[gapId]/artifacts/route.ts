import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import {
  addGapArtifactFileWithBackend,
  addGapArtifactWithBackend,
} from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request, { params }: { params: Promise<{ gapId: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { gapId } = await params
    const ctype = request.headers.get('content-type') || ''
    if (ctype.includes('multipart/form-data')) {
      const formData = await request.formData()
      return NextResponse.json(await addGapArtifactFileWithBackend(gapId, formData, authToken))
    }
    const body = await request.json()
    return NextResponse.json(await addGapArtifactWithBackend(gapId, body, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 400 },
    )
  }
}
