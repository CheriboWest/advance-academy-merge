import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { addGapArtifactWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request, { params }: { params: Promise<{ gapId: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { gapId } = await params
    const body = await request.json()
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    return NextResponse.json(
      await addGapArtifactWithBackend(gapId, { text: body.text }, authToken),
    )
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
