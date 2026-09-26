'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Landing page for the "Stop reminder emails" link. Public (middleware
 * PUBLIC_PATHS) — the token in the link is the credential. It asks before
 * acting: link scanners in some mail clients open every URL in an email, and a
 * GET that unsubscribed would opt people out without them ever clicking.
 */
export default function UnsubscribePage() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  const confirm = async () => {
    setState('busy')
    const params = new URLSearchParams(window.location.search)
    try {
      const res = await fetch('/api/engagement/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: params.get('u'), t: params.get('t') }),
      })
      setState(res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-4">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 text-center shadow-xl">
        {state === 'done' ? (
          <>
            <h1 className="mb-2 font-serif text-xl font-bold text-primary">You&rsquo;re unsubscribed</h1>
            <p className="text-sm text-muted-foreground">
              No more reminder emails. You can turn them back on from your home page any time.
            </p>
          </>
        ) : state === 'error' ? (
          <>
            <h1 className="mb-2 font-serif text-xl font-bold text-primary">That link didn&rsquo;t work</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Sign in and switch reminder emails off from your home page instead.
            </p>
            <Link href="/login" className="text-sm font-semibold text-primary hover:text-highlight-ink">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-serif text-xl font-bold text-primary">Stop reminder emails?</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              You won&rsquo;t get weekly goal or follow-up reminders from Advance Academy.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={state === 'busy'}
              className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
