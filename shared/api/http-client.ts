import type { ApiErrorResponse } from '@advance-academy/contracts'

export class HttpClientError extends Error {
  status: number
  payload: ApiErrorResponse

  constructor(status: number, payload: ApiErrorResponse) {
    super(payload.message)
    this.name = 'HttpClientError'
    this.status = status
    this.payload = payload
  }
}

interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number
}

function buildDefaultError(status: number, statusText: string): ApiErrorResponse {
  return {
    code: status > 0 ? 'HTTP_ERROR' : 'NETWORK_ERROR',
    message: statusText || 'Request failed.',
  }
}

export async function fetchJson<T>(input: RequestInfo | URL, options: FetchJsonOptions = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    })

    const text = await response.text()
    const parsed = text ? JSON.parse(text) : null

    if (!response.ok) {
      throw new HttpClientError(
        response.status,
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? (parsed as ApiErrorResponse)
          : buildDefaultError(response.status, response.statusText),
      )
    }

    return parsed as T
  } catch (error) {
    if (error instanceof HttpClientError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpClientError(504, {
        code: 'TIMEOUT',
        message: 'The request timed out.',
      })
    }

    throw new HttpClientError(0, buildDefaultError(0, error instanceof Error ? error.message : 'Unknown error'))
  } finally {
    clearTimeout(timeout)
  }
}

interface FetchFormDataJsonOptions {
  timeoutMs?: number
  method?: string
  headers?: Record<string, string>
}

export async function fetchFormDataJson<T>(
  input: RequestInfo | URL,
  formData: FormData,
  options: FetchFormDataJsonOptions = {},
) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 120000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      method: options.method ?? 'POST',
      body: formData,
      headers: options.headers,
      signal: controller.signal,
    })

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      throw new HttpClientError(500, {
        code: 'INVALID_RESPONSE',
        message: 'Invalid JSON response.',
      })
    }

    if (!response.ok) {
      throw new HttpClientError(
        response.status,
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? (parsed as ApiErrorResponse)
          : buildDefaultError(response.status, response.statusText),
      )
    }

    return parsed as T
  } catch (error) {
    if (error instanceof HttpClientError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpClientError(504, {
        code: 'TIMEOUT',
        message: 'The request timed out.',
      })
    }

    throw new HttpClientError(0, buildDefaultError(0, error instanceof Error ? error.message : 'Unknown error'))
  } finally {
    clearTimeout(timeout)
  }
}
