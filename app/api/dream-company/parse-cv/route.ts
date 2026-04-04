import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'

export async function POST(request: Request) {
  const { backendUrl } = getServerEnv()
  const formData = await request.formData()

  try {
    const res = await fetch(`${backendUrl}/api/dream-company/parse-cv`, {
      method: 'POST',
      body: formData,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    })
  } catch (error) {
    console.error('Parse CV proxy error:', error)
    return NextResponse.json({ error: 'Failed to reach backend' }, { status: 502 })
  }
}
