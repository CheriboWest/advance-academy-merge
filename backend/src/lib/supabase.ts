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

export function getMvpUserId(): string {
  return process.env.MVP_USER_ID?.trim() || '00000000-0000-0000-0000-000000000000';
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
