'use client'

import { useEffect, useState } from 'react'
import { getAuthHeaders } from '@/shared/auth/get-auth-headers'

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
        if (!res.ok) throw new Error('Could not load referral status')
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
      <div className="rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-serif font-bold text-blue-900">Invite friends, unlock more</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every friend who signs in through your link gives you{' '}
          <strong className="text-blue-900">+2 Dream Company credits</strong> — up to 3 friends.
        </p>

        {error && <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {status && (
          <>
            {/* Invite link */}
            <div className="mt-6">
              <label className="mb-1 block text-sm font-medium text-blue-900">Your invite link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-600 outline-none"
                />
                <button
                  onClick={copyLink}
                  className="shrink-0 rounded-lg bg-yellow-500 px-4 text-sm font-semibold text-blue-900 hover:bg-yellow-400 transition"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Progress */}
            <div className="mt-6">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-gray-500">Referrals</span>
                <span className="font-semibold text-blue-900">
                  {status.referralCount} / {status.maxReferrals}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-yellow-500 transition-all"
                  style={{ width: `${(status.referralCount / status.maxReferrals) * 100}%` }}
                />
              </div>
            </div>

            {/* Mentorship CTA once capped */}
            {capped && (
              <div className="mt-8 rounded-xl border border-blue-900/20 bg-blue-50 p-5 text-center">
                <p className="text-sm font-semibold text-blue-900">
                  You&apos;ve maxed out your referral rewards 🎉
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Ready to go further? Join our Mentorship programme for unlimited access and
                  1-on-1 guidance.
                </p>
                <a
                  href={mentorshipUrl}
                  className="mt-4 inline-block rounded-lg bg-blue-900 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-800 transition"
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
