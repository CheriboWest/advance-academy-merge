import { NextResponse } from 'next/server'
import { listCvVersionsWithBackend, uploadCvFileWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function GET() {
  try {
    return NextResponse.json(await listCvVersionsWithBackend())
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    return NextResponse.json(await uploadCvFileWithBackend(formData))
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
