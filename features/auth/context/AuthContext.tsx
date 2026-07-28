'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { CurrentUser } from '@advance-academy/contracts'
import { getSupabaseBrowser } from '@/shared/auth/supabase-browser'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** null until GET /api/me resolves. */
  account: CurrentUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
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
  const [account, setAccount] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAccount = useCallback(async (accessToken: string | undefined) => {
    if (!accessToken) {
      setAccount(null)
      syncSessionCookie(null)
      return
    }
    // Unknown status: let middleware through and let the backend 403 decide.
    syncSessionCookie('1')
    try {
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) return
      const me = (await res.json()) as CurrentUser
      setAccount(me)
      syncSessionCookie(me.status)
    } catch {
      // Network hiccup — leave the cookie at '1'; the backend still gates the data.
    }
  }, [])

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadAccount(data.session?.access_token)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      void loadAccount(session?.access_token)
    })

    return () => subscription.unsubscribe()
  }, [loadAccount])

  async function signIn(email: string, password: string) {
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string) {
    const { error } = await getSupabaseBrowser().auth.signUp({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await getSupabaseBrowser().auth.signOut()
    setAccount(null)
    syncSessionCookie(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, account, loading, signIn, signUp, signOut }}
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
