'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/features/auth/context/AuthContext'

// Magic-link landing (CA-001, P2/2a). Supabase redirects here with the session
// tokens in the URL hash; the browser client (detectSessionInUrl) picks them up
// and writes the session cookies. We just wait for the session to appear, then
// send the user into the app. If it never arrives (expired/reused link), we show
// a recovery message.
//
// This page must stay in middleware's PUBLIC_PATHS: the hash never reaches the
// server, so at request time there is no session yet and middleware would bounce
// it to /login before the client could read the token.
export default function AuthCallbackPage() {
  const { session, loading } = useAuth()
  const router = useRouter()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Supabase reports failures as `#error=...` in the hash.
    if (typeof window !== 'undefined' && window.location.hash.includes('error')) {
      setFailed(true)
      return
    }
    if (session) {
      // Referral crediting now happens on the invitee's FIRST TOOL USE (see
      // backend lib/credits.ts), not here — logging in alone doesn't earn the
      // inviter a credit. So just enter the app.
      router.replace('/')
      return
    }
    // Fallback: no session established within a few seconds.
    const t = setTimeout(() => {
      if (!session) setFailed(true)
    }, 6000)
    return () => clearTimeout(t)
  }, [session, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-4">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 text-center shadow-xl">
        {failed ? (
          <>
            <h1 className="mb-2 text-xl font-serif font-bold text-primary">Link expired</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              This login link is invalid or has already been used. Please request a new one.
            </p>
            <Link
              href="/login"
              className="inline-block text-sm font-semibold text-primary transition-colors hover:text-highlight-ink"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-t-primary" />
            <h1 className="text-xl font-serif font-bold text-primary">Signing you in…</h1>
            <p className="mt-1 text-sm text-muted-foreground">{loading ? 'Preparing your session.' : 'Almost there.'}</p>
          </>
        )}
      </div>
    </div>
  )
}
