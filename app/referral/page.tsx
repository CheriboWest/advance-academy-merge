'use client'

import { useEffect, useState } from 'react'
import { BackLink } from '@/components/back-link'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'
import { HttpClientError } from '@/shared/api/http-client'

interface ReferralStatus {
  code: string
  referralCount: number
  maxReferrals: number
  remaining: number
}

// Referral page (CA-001, P3c). Shows the user's invite link, progress toward the
// 3-referral cap (+2 Dream Company credits each), and the Mentorship CTA once the
// cap is reached.
export default function ReferralPage() {
  const [status, setStatus] = useState<ReferralStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/referral/me', { headers: await getAuthHeaders() })
        // HttpClientError so a 403 ACCOUNT_PENDING routes to /pending instead of
        // showing a pending user a generic "could not load" on this page.
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
          throw new HttpClientError(res.status, {
            code: body.code ?? 'REFERRAL_FAILED',
            message: body.message ?? 'Could not load referral status',
          })
        }
        setStatus(await res.json())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong')
      }
    })()
  }, [])

  // The invite link lands on the quiz funnel, tagged for attribution. Set
  // NEXT_PUBLIC_QUIZ_URL to your quiz's public URL.
  const quizBase = (process.env.NEXT_PUBLIC_QUIZ_URL ?? '').replace(/\/+$/, '')
  const inviteUrl = status ? `${quizBase}/?ref=${status.code}&utm_source=referral` : ''
  const mentorshipUrl = process.env.NEXT_PUBLIC_MENTORSHIP_URL ?? '#'
  const capped = status ? status.remaining === 0 : false

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <BackLink href="/" className="mb-6">
        Back to home
      </BackLink>
      <div className="rounded-2xl bg-background p-8 shadow-xl">
        <h1 className="text-2xl font-serif font-bold text-primary">Invite friends, unlock more</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every friend who signs in through your link gives you{' '}
          <strong className="text-primary">+2 Dream Company credits</strong> — up to 3 friends.
        </p>

        {error && <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {status && (
          <>
            {/* Invite link */}
            <div className="mt-6">
              <label className="mb-1 block text-sm font-medium text-primary">Your invite link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground outline-none"
                />
                <button
                  onClick={copyLink}
                  className="shrink-0 rounded-lg bg-secondary px-4 text-sm font-semibold text-primary hover:bg-secondary/90 transition"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Progress */}
            <div className="mt-6">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Referrals</span>
                <span className="font-semibold text-primary">
                  {status.referralCount} / {status.maxReferrals}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-card">
                <div
                  className="h-full rounded-full bg-secondary transition-all"
                  style={{ width: `${(status.referralCount / status.maxReferrals) * 100}%` }}
                />
              </div>
            </div>

            {/* Mentorship CTA once capped */}
            {capped && (
              <div className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-5 text-center">
                <p className="text-sm font-semibold text-primary">
                  You&apos;ve maxed out your referral rewards 🎉
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ready to go further? Join our Mentorship programme for unlimited access and
                  1-on-1 guidance.
                </p>
                <a
                  href={mentorshipUrl}
                  className="mt-4 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
                >
                  Explore Mentorship →
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
