/**
 * What a route may show the student when something throws.
 *
 * Our own errors carry `statusCode` and, below 500, a message written for the
 * student ("Paste the job description…", "You need 1 credit…") — those pass
 * through. Everything else — Anthropic SDK errors (they carry `status`, not
 * `statusCode`, and their message is the provider's raw JSON), Supabase
 * errors, our own 5xx and the 503 "LLM_API_KEY is not set in backend/.env" —
 * gets `fallback`. Routes still log the real error.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : NaN;
  if (error instanceof Error && error.message && statusCode >= 400 && statusCode < 500) return error.message;
  return fallback;
}
