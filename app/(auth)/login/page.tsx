'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/features/auth/context/AuthContext'

export default function LoginPage() {
  const { signIn, sendMagicLink } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    router.push('/')
  }

  // Passwordless alternative — emails a magic login link via Resend (CA-001 P2).
  async function handleMagicLink() {
    setError(null)
    if (!email) {
      setError('Enter your email first, then request a login link.')
      return
    }
    setLinkLoading(true)
    const { error } = await sendMagicLink(email)
    setLinkLoading(false)
    if (error) {
      setError(error)
      return
    }
    setLinkSent(true)
  }

  if (linkSent) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-background rounded-2xl shadow-xl p-8 text-center">
          <h2 className="text-xl font-serif font-bold text-primary mb-2">Check your email</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We sent a login link to <strong className="text-primary">{email}</strong>. Click it to sign in.
          </p>
          <button
            onClick={() => setLinkSent(false)}
            className="text-sm font-semibold text-primary hover:text-highlight-ink transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-background rounded-2xl shadow-xl p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-serif font-bold text-primary">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue your career journey</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-primary mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring transition"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-primary mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-secondary text-primary text-sm font-semibold py-3 hover:bg-secondary/90 disabled:opacity-50 transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Passwordless alternative */}
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-muted" />
          <span className="text-xs text-subtle-foreground">or</span>
          <span className="h-px flex-1 bg-muted" />
        </div>
        <button
          type="button"
          onClick={handleMagicLink}
          disabled={linkLoading}
          className="w-full rounded-lg border border-primary text-primary text-sm font-semibold py-3 hover:bg-primary/10 disabled:opacity-50 transition"
        >
          {linkLoading ? 'Sending link…' : 'Email me a login link'}
        </button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-semibold text-primary hover:text-highlight-ink transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
