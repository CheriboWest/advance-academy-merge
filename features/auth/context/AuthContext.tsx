'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/shared/auth/supabase-browser'
import type { UserStatus } from '@/types/admin'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** Approval status; null until GET /api/account/me resolves. */
  status: UserStatus | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  // Passwordless: request a magic login link emailed via Resend (CA-001 P2).
  sendMagicLink: (email: string, name?: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ponytail: the cookie is a UX hint for middleware.ts only — it is client-set and
// forgeable, so the real gate stays the backend 403. Do not put server-rendered
// data behind it. Value is the approval status once known, '1' while unknown.
function syncSessionCookie(value: string | null) {
  if (!value) {
    document.cookie = 'aa-session=; path=/; max-age=0; SameSite=Lax'
    return
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `aa-session=${value}; path=/; max-age=3600; SameSite=Lax${secure}`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Duplicates shared/hooks/use-account on cold load. Deliberate: the provider
  // sits above the query client and has to set the cookie before any page renders.
  const loadStatus = useCallback(async (accessToken: string | undefined) => {
    if (!accessToken) {
      setStatus(null)
      syncSessionCookie(null)
      return
    }
    // Unknown status: let middleware through and let the backend 403 decide.
    syncSessionCookie('1')
    try {
      const res = await fetch('/api/account/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) return
      const me = (await res.json()) as { status: UserStatus }
      setStatus(me.status)
      syncSessionCookie(me.status)
    } catch {
      // Network hiccup — leave the cookie at '1'; the backend still gates the data.
    }
  }, [])

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadStatus(data.session?.access_token)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      void loadStatus(session?.access_token)
    })

    return () => subscription.unsubscribe()
  }, [loadStatus])

  async function signIn(email: string, password: string) {
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function sendMagicLink(email: string, name?: string) {
    try {
      const res = await fetch('/api/auth/passwordless', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        return { error: data.message ?? 'Could not send your login link.' }
      }
      return { error: null }
    } catch {
      return { error: 'Could not send your login link. Please try again.' }
    }
  }

  async function signOut() {
    await getSupabaseBrowser().auth.signOut()
    setStatus(null)
    syncSessionCookie(null)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        status,
        loading,
        signIn,
        sendMagicLink,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
