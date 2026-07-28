import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register']

// ponytail: routing convenience only. The `aa-session` cookie is client-set and
// forgeable — the real gate is the backend 403 (ACCOUNT_PENDING / ACCOUNT_REJECTED).
// Never put server-rendered data behind this check.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const status = request.cookies.get('aa-session')?.value
  if (!status) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // '1' means the status hasn't loaded yet — let it through rather than flashing
  // the pending screen at an approved user on every cold load.
  const onPending = pathname.startsWith('/pending')
  const settled = status === 'pending' || status === 'rejected'

  if (settled && !onPending) {
    const url = request.nextUrl.clone()
    url.pathname = '/pending'
    return NextResponse.redirect(url)
  }
  if (status === 'approved' && onPending) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.*|apple-icon.*|api/).*)'],
}
