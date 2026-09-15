import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Reads and writes the auth session via cookies so server-side code
 * always sees the current user.
 *
 * Uses the public anon key only. Private coach data is protected by Row Level
 * Security keyed to `auth.uid()` — the server never uses the service role key.
 *
 * Created lazily inside the function so importing this module never throws at
 * build time when the environment variables are absent.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local (see .env.local.example)."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // `setAll` can be called from a Server Component, where writing
          // cookies is not allowed. Session refresh is handled by middleware,
          // so this can be safely ignored.
        }
      },
    },
  });
}
