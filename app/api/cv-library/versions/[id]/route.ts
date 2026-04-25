import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import {
  deleteCvVersionWithBackend,
  getCvVersionWithBackend,
} from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { id } = await params
    return NextResponse.json(await getCvVersionWithBackend(id, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { id } = await params
    return NextResponse.json(await deleteCvVersionWithBackend(id, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
