import { NextResponse } from 'next/server'
import {
  deleteCvVersionWithBackend,
  getCvVersionWithBackend,
} from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await getCvVersionWithBackend(id))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await deleteCvVersionWithBackend(id))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
