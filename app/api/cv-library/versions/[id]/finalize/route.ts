import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { finalizeCvVersionWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { id } = await params
    const body = await request.json()
    return NextResponse.json(await finalizeCvVersionWithBackend(id, body, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
