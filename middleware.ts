import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// /auth/callback finalises the magic-link session client-side (the token arrives
// in the URL hash, which never reaches the server) — it MUST be public, or the
// middleware would bounce it to /login before the session cookie is set.
const PUBLIC_PATHS = ['/login', '/register', '/auth/callback']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const hasSession = request.cookies.has('aa-session')
  if (!hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.*|apple-icon.*|api/).*)'],
}
