import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { updateArtifactWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const authToken = getProxyAuthToken(request)
  try {
    const { artifactId } = await params
    const body = await request.json()
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    return NextResponse.json(
      await updateArtifactWithBackend(artifactId, { text: body.text }, authToken),
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
