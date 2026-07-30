import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { patchAdminUserOnBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'
import type { AdminUserPatch, Tier } from '@/types/admin'

const TIERS: Tier[] = ['trial', 'membership']

// Validate here as well as on the backend — the proxy layer owns request-shape
// checks so a malformed body never reaches Fastify (see docs/ARCHITECTURE.md).
function toPatch(body: unknown): AdminUserPatch | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const patch: AdminUserPatch = {}

  if (b.tier !== undefined) {
    if (typeof b.tier !== 'string' || !TIERS.includes(b.tier as Tier)) return null
    patch.tier = b.tier as Tier
  }
  if (b.creditDelta !== undefined) {
    if (typeof b.creditDelta !== 'number' || !Number.isInteger(b.creditDelta)) return null
    patch.creditDelta = b.creditDelta
  }
  if (b.isAdmin !== undefined) {
    if (typeof b.isAdmin !== 'boolean') return null
    patch.isAdmin = b.isAdmin
  }
  return Object.keys(patch).length > 0 ? patch : null
}

// Admin user update (sprint F4): tier change, credit top-up, admin toggle.
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const authToken = getProxyAuthToken(request)
  try {
    const { userId } = await params
    const patch = toPatch(await request.json().catch(() => null))
    if (!patch) {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Provide at least one of: tier, creditDelta, isAdmin.' },
        { status: 400 },
      )
    }
    return NextResponse.json(await patchAdminUserOnBackend(userId, patch, authToken))
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to update the account.' },
      { status: 500 },
    )
  }
}
