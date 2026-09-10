import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

type Ctx = { params: Promise<{ id: string }> }

function authHeaders(token: string | undefined, json = false): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// One tracked job with its status timeline. Someone else's id is a plain 404.
export async function GET(request: Request, { params }: Ctx) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/job-tracking/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: authHeaders(token),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'LOAD_FAILED', message: 'Could not load that job.' },
      { status: 502 },
    )
  }
}

// Notes, dates, links — anything but status, which has its own route so every
// move is logged.
export async function PATCH(request: Request, { params }: Ctx) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Invalid request body.' },
      { status: 400 },
    )
  }

  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/job-tracking/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(token, true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'UPDATE_FAILED', message: 'Could not update that job.' },
      { status: 502 },
    )
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)
  try {
    const { id } = await params
    const res = await fetch(`${backendUrl}/api/job-tracking/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(token),
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 204) return new NextResponse(null, { status: 204 })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'DELETE_FAILED', message: 'Could not delete that job.' },
      { status: 502 },
    )
  }
}
