import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'

export async function POST(request: Request) {
  const authToken = getProxyAuthToken(request)
  const contentType = request.headers.get('content-type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data') || !request.body) {
    return NextResponse.json({ error: 'Invalid multipart body.' }, { status: 400 })
  }

  try {
    const { backendUrl } = getServerEnv()
    const headers: Record<string, string> = { 'Content-Type': contentType }
    if (authToken) headers.Authorization = `Bearer ${authToken}`

    // Preserve the multipart stream instead of buffering the full recording in
    // Next and constructing a second FormData payload.
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers,
      body: request.body,
      duplex: 'half',
      signal: AbortSignal.timeout(60_000),
    }
    const response = await fetch(`${backendUrl}/api/interview/transcribe`, init)
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        code: error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'PROXY_ERROR',
        message:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'Transcription timed out.'
            : 'Transcription proxy failed.',
      },
      { status: error instanceof Error && error.name === 'TimeoutError' ? 504 : 502 },
    )
  }
}
