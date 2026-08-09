import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const err = new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env.',
    );
    Object.assign(err, { statusCode: 503 });
    throw err;
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/**
 * True when a query failed because the database is missing a column the code
 * expects — i.e. this deploy is running ahead of its migration.
 *
 * Migrations in this project are applied by hand in the Supabase SQL editor,
 * with no tool enforcing that they land before the code that needs them. Callers
 * use this to degrade (write the row without the new column) instead of failing
 * a request outright, so a lagging migration costs data richness rather than
 * uptime. `PGRST204` is PostgREST's "column not found in schema cache"; `42703`
 * is Postgres' own undefined_column.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: string; message?: string };
  if (code === 'PGRST204' || code === '42703') return true;
  return /column .* does not exist|could not find the .* column/i.test(message ?? '');
}

export async function getUserIdFromToken(token: string): Promise<string> {
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    const err = new Error('Unauthorized');
    Object.assign(err, { statusCode: 401 });
    throw err;
  }
  return user.id;
}
