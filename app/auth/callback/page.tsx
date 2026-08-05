'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/features/auth/context/AuthContext'

// Magic-link landing (CA-001, P2/2a). Supabase redirects here with the session
// tokens in the URL hash; the browser client (detectSessionInUrl) picks them up
// and AuthContext sets the `aa-session` cookie. We just wait for the session to
// appear, then send the user into the app. If it never arrives (expired/reused
// link), we show a recovery message.
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        {failed ? (
          <>
            <h1 className="mb-2 text-xl font-serif font-bold text-blue-900">Link expired</h1>
            <p className="mb-6 text-sm text-gray-500">
              This login link is invalid or has already been used. Please request a new one.
            </p>
            <Link
              href="/login"
              className="inline-block text-sm font-semibold text-blue-900 transition-colors hover:text-yellow-600"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-blue-900" />
            <h1 className="text-xl font-serif font-bold text-blue-900">Signing you in…</h1>
            <p className="mt-1 text-sm text-gray-500">{loading ? 'Preparing your session.' : 'Almost there.'}</p>
          </>
        )}
      </div>
    </div>
  )
}
