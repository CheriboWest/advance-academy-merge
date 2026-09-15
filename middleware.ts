import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// /auth/callback finalises the magic-link session client-side (the token arrives
// in the URL hash, which never reaches the server) — it MUST be public, or the
// middleware would bounce it to /login before the session cookie is set.
// career-hub's student-facing pages are public by design — company and job
// discovery is the top of the funnel, reachable before anyone has an account.
// The matcher below gates EVERY page route, so omitting these would redirect the
// entire public surface to /login.
//
// '/coach/login' is public for the obvious reason — it is a sign-in page, and
// without it middleware bounces coaches to /login before they can reach it. It
// now signs into the same session as /login (both write the same Supabase
// cookies since Stage 3), so the two are redundant; consolidating them is a
// user-facing call, not a merge detail, so both stay for now.
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/auth/callback',
  '/search',
  '/companies',
  '/coach/login',
]

/**
 * Authentication only: is there a real Supabase session?
 *
 * This used to read an `aa-session` cookie that the browser set with
 * `document.cookie`, which meant anyone could type
 * `document.cookie = 'aa-session=approved'` and walk past it. It was documented
 * as a UX hint rather than a gate, with the backend 403 doing the real work.
 * With `@supabase/ssr` the session is a real, signed, httpOnly cookie, so this
 * is now an actual gate and the hint cookie is gone.
 *
 * The *approval* gate (users.status -> 403 ACCOUNT_PENDING / ACCOUNT_REJECTED)
 * deliberately stays in Fastify (backend/src/main.ts), the one choke point every
 * route already passes through. Reading it here would cost a database round trip
 * on every page request to duplicate a check that already exists — and a second
 * copy of "who is allowed in" is how the two drift apart. A pending user is
 * routed to /pending by the 403 handler in shared/api/http-client.ts, and
 * /pending sends them onward once approval lands.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Exact match or a real path segment below it: `/companies` must cover
  // `/companies/acme`, but a bare startsWith would also make `/companies-admin`
  // — or any future route sharing a prefix — public by accident.
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (isPublic) {
    return NextResponse.next()
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Without Supabase configured there is no session to read. Fall through rather
  // than redirect every route to /login, which would make a misconfigured deploy
  // look like a broken login instead of a missing env var. Nothing is exposed:
  // the data still sits behind Fastify's bearer check.
  if (!url || !key) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Also refreshes a rotating token, which is why the cookies above are written
  // back onto `response`.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.*|apple-icon.*|api/).*)'],
}
