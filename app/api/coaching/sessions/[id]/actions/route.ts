import { NextResponse } from 'next/server'
import { getServerEnv } from '@/shared/env/server'
import { getProxyAuthToken } from '@/shared/api/proxy-auth'

/**
 * One proxy for the coach's verbs (ticket T5): generate, approve, reopen, and
 * rewriting a single question.
 *
 * Folded into one route rather than four near-identical files. The `action`
 * field decides the backend path, and anything not on the allowlist is rejected
 * here rather than being concatenated into a URL.
 */
const ACTIONS: Record<string, (id: string, body: Record<string, unknown>) => string | null> = {
  generate: (id) => `/api/coaching/sessions/${encodeURIComponent(id)}/generate`,
  approve: (id) => `/api/coaching/sessions/${encodeURIComponent(id)}/approve`,
  reopen: (id) => `/api/coaching/sessions/${encodeURIComponent(id)}/reopen`,
  'regenerate-question': (id, body) => {
    const questionId = typeof body.questionId === 'string' ? body.questionId : null
    if (!questionId) return null
    return `/api/coaching/sessions/${encodeURIComponent(id)}/questions/${encodeURIComponent(questionId)}/regenerate`
  },
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { backendUrl } = getServerEnv()
  const token = getProxyAuthToken(request)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const buildPath = ACTIONS[action]
  if (!buildPath) {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: `Unknown action "${action}".` },
      { status: 400 },
    )
  }

  try {
    const { id } = await params
    const path = buildPath(id, body)
    if (!path) {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'questionId is required.' },
        { status: 400 },
      )
    }

    const res = await fetch(`${backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      // Rewriting one question is a real LLM call; the rest return immediately.
      signal: AbortSignal.timeout(action === 'regenerate-question' ? 90000 : 20000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { code: 'ACTION_FAILED', message: 'That action could not be completed.' },
      { status: 502 },
    )
  }
}
