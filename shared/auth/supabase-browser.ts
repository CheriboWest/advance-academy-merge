import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Annotated rather than inferred: `createBrowserClient`'s return type does not
// resolve the generic the way `createClient` did, which left auth callbacks
// (`onAuthStateChange`, `getSession`) with implicitly-`any` parameters.
let client: SupabaseClient | null = null

/**
 * Supabase client for the browser.
 *
 * `createBrowserClient` rather than plain `createClient` so the session lives in
 * cookies instead of localStorage, which is what lets `middleware.ts` and Server
 * Components see who is signed in. Before this, the server had no session at all
 * and middleware had to trust a hint cookie the browser wrote itself.
 *
 * The exported name is unchanged on purpose: every call site keeps working.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')
  client = createBrowserClient(url, key)
  return client
}
