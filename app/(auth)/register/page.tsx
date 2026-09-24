'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/features/auth/context/AuthContext'

// Passwordless registration (CA-001, P2/2b): enter an email, receive a magic
// login link (sent via Resend). No password is set — "forgot password" covers
// other devices. Existing password-based login still works on /login.
export default function RegisterPage() {
  const { sendMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await sendMagicLink(email, name || undefined)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-background rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-serif font-bold text-blue-900 mb-2">Check your email</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We sent a login link to <strong className="text-blue-900">{email}</strong>. Click it to sign
            in — no password needed.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            After that, a coach reviews your account before access is granted — usually within one working day.
            We&apos;ll open up the tools as soon as it&apos;s approved.
          </p>
          <Link href="/login" className="inline-block text-sm font-semibold text-blue-900 hover:text-yellow-600 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-background rounded-2xl shadow-xl p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-serif font-bold text-blue-900">Create account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your email — we&apos;ll send you a login link</p>
          <p className="mt-3 text-xs text-muted-foreground bg-card rounded-lg px-3 py-2">
            Accounts are reviewed by a coach before access is granted — usually within one working day.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-blue-900 mb-1">
              Full name <span className="text-subtle-foreground">(optional)</span>
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900 transition"
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-blue-900 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900 transition"
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-yellow-500 text-blue-900 text-sm font-semibold py-3 hover:bg-yellow-400 disabled:opacity-50 transition"
          >
            {loading ? 'Sending link…' : 'Send me a login link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-blue-900 hover:text-yellow-600 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
