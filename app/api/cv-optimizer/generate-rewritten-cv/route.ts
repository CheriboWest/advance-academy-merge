import { NextResponse } from 'next/server'
import { generateRewrittenCvWithBackend } from '@/shared/api/backend-client'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

export async function POST(request: Request) {
  try {
    const authToken = getProxyAuthToken(request)
    const formData = await request.formData()
    const backendResponse = await generateRewrittenCvWithBackend(formData, authToken)

    if (!backendResponse.ok) {
      const text = await backendResponse.text()
      let payload: unknown
      try {
        payload = text ? JSON.parse(text) : { code: 'REWRITE_FAILED', message: 'Rewrite failed.' }
      } catch {
        payload = { code: 'REWRITE_FAILED', message: text || 'Rewrite failed.' }
      }
      return NextResponse.json(payload, { status: backendResponse.status })
    }

    const arrayBuffer = await backendResponse.arrayBuffer()
    const headers = new Headers()
    const contentType = backendResponse.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    const disposition = backendResponse.headers.get('content-disposition')
    if (disposition) headers.set('content-disposition', disposition)
    const applied = backendResponse.headers.get('x-rewrites-applied')
    if (applied) headers.set('x-rewrites-applied', applied)
    const total = backendResponse.headers.get('x-rewrites-total')
    if (total) headers.set('x-rewrites-total', total)

    return new NextResponse(arrayBuffer, { status: 200, headers })
  } catch (error) {
    return NextResponse.json(
      {
        code: 'REWRITE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to generate rewritten CV.',
      },
      { status: 500 },
    )
  }
}
