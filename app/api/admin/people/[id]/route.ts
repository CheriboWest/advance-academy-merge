import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getAdminPersonFromBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

// One person's admin profile. Thin proxy: forward the caller's bearer token to
// the backend, which enforces the admin gate. 403 and 404 pass straight through
// so the drawer can tell "not allowed" from "no such person".
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authToken = getProxyAuthToken(request)
  const { id } = await context.params

  if (!id.trim()) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'An id is required.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await getAdminPersonFromBackend(id, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to load this person.' },
      { status: 500 },
    )
  }
}
