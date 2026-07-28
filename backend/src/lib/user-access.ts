import { getSupabase } from './supabase.js';

export type UserStatus = 'pending' | 'approved' | 'rejected';

export interface UserAccess {
  userId: string;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
}

// ponytail: 60s in-memory Map, one PK lookup per user per minute. Approvals take
// effect within a minute, which is fine for a human-reviewed queue. Move to Redis
// only if we run >1 backend instance AND that minute starts mattering.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: UserAccess; expiresAt: number }>();

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const { data, error } = await getSupabase()
    .from('users')
    .select('id, email, status, is_admin')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    const err = new Error('Could not verify account status.');
    Object.assign(err, { statusCode: 503 });
    throw err;
  }

  // No row means the auth.users → public.users trigger (migration 006) did not fire.
  // Treat as pending rather than approved: fail closed.
  const value: UserAccess = {
    userId,
    email: data?.email ?? '',
    status: (data?.status as UserStatus) ?? 'pending',
    isAdmin: data?.is_admin === true,
  };

  cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Called after an admin review so the decision is not hidden behind the TTL. */
export function invalidateUserAccess(userId: string) {
  cache.delete(userId);
}

/**
 * The approval gate decision. Pure, so it can be tested without a DB — this is the
 * security-critical part; the surrounding cache is a plain TTL Map.
 *
 * 403 rather than 401: the token IS valid, the account just isn't cleared. The
 * frontend needs to tell them apart (401 → re-login, 403 → show /pending).
 */
export function approvalError(
  access: Pick<UserAccess, 'status'>,
): { code: string; message: string } | null {
  if (access.status === 'approved') return null;
  if (access.status === 'rejected') {
    return {
      code: 'ACCOUNT_REJECTED',
      message: 'Your account request was not approved. Contact your programme coach.',
    };
  }
  // 'pending' and anything unrecognised — fail closed.
  return {
    code: 'ACCOUNT_PENDING',
    message: 'Your account is awaiting approval. You will get access once a coach reviews it.',
  };
}
