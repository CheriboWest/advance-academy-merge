import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { getServerEnv } from '@/shared/env/server'

/**
 * Server-only SSE passthrough for the Dream Company streaming routes.
 *
 * Forwards the request body + bearer token to the backend's `/stream` endpoint and pipes the
 * `text/event-stream` response straight back to the browser without buffering. If the backend
 * replies with a normal JSON error first (validation 400 / auth 401, sent before it starts the
 * stream), that JSON + status is passed through unchanged so the client gets a clean error.
 *
 * Only import from Next.js route handlers — it reads server-only BACKEND_URL.
 */
export async function proxyStream(request: Request, backendPath: string): Promise<Response> {
  const body = await request.text()
  const token = getProxyAuthToken(request)
  const { backendUrl } = getServerEnv()

  let res: Response
  try {
    res = await fetch(`${backendUrl}${backendPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    })
  } catch {
    return new Response(
      JSON.stringify({ code: 'BACKEND_UNAVAILABLE', message: 'Could not reach the analysis service. Please try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream') || !res.body) {
    // Backend replied with a normal JSON error before starting the stream — pass it through.
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': contentType || 'application/json' },
    })
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
