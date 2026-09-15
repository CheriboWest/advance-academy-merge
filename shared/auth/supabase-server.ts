import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Anon key only — this is the *user's* session, not an admin context. Anything
 * that needs to read past RLS goes through Fastify, which holds the service role
 * key (backend/src/lib/supabase.ts).
 *
 * Created inside the function so importing this module never throws at build
 * time when the env vars are absent.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')

  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Writing cookies is not allowed from a Server Component. Middleware
          // refreshes the session on every request, so ignoring this is safe.
        }
      },
    },
  })
}
