import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'

export async function POST(request: Request) {
  const { backendUrl } = getServerEnv()
  const bodyText = await request.text()

  try {
    const res = await fetch(`${backendUrl}/api/outreach/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    })
  } catch (error) {
    console.error('Outreach proxy error:', error)
    return NextResponse.json({ error: 'Failed to reach backend' }, { status: 502 })
  }
}
