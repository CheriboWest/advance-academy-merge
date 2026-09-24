'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/features/auth/context/AuthContext'

export default function PendingPage() {
  const { user, status, loading, signOut } = useAuth()
  const router = useRouter()
  const rejected = status === 'rejected'

  // Middleware only sees the cookie as it was at request time, so an approval that
  // lands during this page's lifetime has to be routed client-side.
  useEffect(() => {
    if (status === 'approved') router.replace('/')
  }, [status, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-card px-4">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={
                rejected
                  ? 'M6 18L18 6M6 6l12 12'
                  : 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
              }
            />
          </svg>
        </div>

        <h1 className="text-xl font-serif font-bold text-primary mb-2">
          {loading ? 'Checking your account…' : rejected ? 'Access not approved' : 'Awaiting approval'}
        </h1>

        <p className="text-sm text-muted-foreground mb-6">
          {rejected ? (
            <>Your account request was not approved. Please speak to your programme coach if you think this is a mistake.</>
          ) : (
            <>
              Thanks for signing up{user?.email ? <> as <strong className="text-primary">{user.email}</strong></> : null}.
              A coach needs to approve your account before you can use the tools — this is usually done within one working day.
              You&apos;ll be able to sign in and start straight away once it&apos;s approved.
            </>
          )}
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-secondary text-primary text-sm font-semibold py-3 hover:bg-secondary/90 transition"
          >
            Check again
          </button>
          <button
            onClick={() => void signOut()}
            className="w-full text-sm font-semibold text-primary hover:text-highlight-ink py-2 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
