/**
 * Where to go after sign-in. Middleware sends a signed-out visitor to
 * `/login?next=<path>` so a deep link (e.g. Career Hub's "Save" →
 * `/jobs?add=…`) survives the login. The magic link lands on /auth/callback
 * with no query of its own, so the login page also parks `next` in
 * localStorage for the callback to pick up.
 */
const STORAGE_KEY = 'aa-next'

/** Only same-origin paths: `/x` yes; `//evil.com`, `/\evil.com`, `https://…` no. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

export function rememberNextPath(raw: string | null | undefined): void {
  const next = safeNextPath(raw)
  if (!next) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Private mode / blocked storage: the password path still has ?next=.
  }
}

/** Read and clear the parked path. */
export function takeNextPath(): string | null {
  try {
    const next = safeNextPath(localStorage.getItem(STORAGE_KEY))
    localStorage.removeItem(STORAGE_KEY)
    return next
  } catch {
    return null
  }
}
