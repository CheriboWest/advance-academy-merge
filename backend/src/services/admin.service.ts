import { getSupabase } from '../lib/supabase.js';
import { membershipGrant, type Tier } from '../lib/credits.js';

/**
 * Admin user management (sprint F4).
 *
 * Backs /admin/users: list accounts, move them between tiers, top up credits and
 * toggle the admin flag. Every mutation writes an `admin_actions` row (migration
 * 016) so "who granted these credits, and when" is answerable later.
 *
 * All access control lives in the route (lib/admin.ts) — this module assumes the
 * caller is already proven to be an admin.
 */

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  tier: Tier;
  is_admin: boolean;
  credit_balance: number;
  referral_count: number;
  first_tool_used_at: string | null;
  created_at: string;
}

export interface ListUsersFilters {
  /** Case-insensitive substring match on email. */
  search?: string;
  tier?: string;
  limit?: number;
}

const SELECT_COLS =
  'id, email, full_name, tier, is_admin, credit_balance, referral_count, first_tool_used_at, created_at';

export async function listUsers(filters: ListUsersFilters = {}): Promise<AdminUserRow[]> {
  const supabase = getSupabase();
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);

  let query = supabase.from('users').select(SELECT_COLS).order('created_at', { ascending: false }).limit(limit);
  if (filters.tier) query = query.eq('tier', filters.tier);
  if (filters.search?.trim()) query = query.ilike('email', `%${filters.search.trim()}%`);

  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error('Could not load users'), { statusCode: 500, cause: error });
  }
  return (data ?? []) as unknown as AdminUserRow[];
}

export interface UpdateUserPatch {
  tier?: Tier;
  /** Signed change to the wallet, e.g. +5 or -2. */
  creditDelta?: number;
  isAdmin?: boolean;
}

/**
 * Apply an admin patch to one account and record what changed.
 *
 * Tier upgrades top the wallet up to the membership grant rather than adding to
 * it, so repeatedly toggling a tier can't farm credits. `max(current, grant)`
 * means an inviter who already earned past 20 through referrals keeps their
 * larger balance.
 */
export async function updateUser(
  actorId: string,
  targetId: string,
  patch: UpdateUserPatch,
): Promise<AdminUserRow> {
  const supabase = getSupabase();

  const { data: before, error: readErr } = await supabase
    .from('users')
    .select(SELECT_COLS)
    .eq('id', targetId)
    .maybeSingle();
  if (readErr) {
    throw Object.assign(new Error('Could not load the account'), { statusCode: 500, cause: readErr });
  }
  if (!before) {
    throw Object.assign(new Error('No such user'), { statusCode: 404 });
  }
  const current = before as unknown as AdminUserRow;

  // Lockout guard: an admin removing their own flag could leave nobody able to
  // reach /admin (the env allowlist may well be empty in production).
  if (patch.isAdmin === false && actorId === targetId) {
    throw Object.assign(new Error('You cannot remove your own admin access.'), { statusCode: 400 });
  }

  const updates: Record<string, unknown> = {};
  const audits: { action: string; detail: Record<string, unknown> }[] = [];

  if (patch.tier && patch.tier !== current.tier) {
    updates.tier = patch.tier;
    const detail: Record<string, unknown> = { from: current.tier, to: patch.tier };
    if (patch.tier === 'membership') {
      const grant = membershipGrant();
      if (current.credit_balance < grant) {
        updates.credit_balance = grant;
        detail.granted = grant - current.credit_balance;
      }
    }
    audits.push({ action: 'set_tier', detail });
  }

  if (patch.creditDelta) {
    const base = (updates.credit_balance as number | undefined) ?? current.credit_balance;
    const next = Math.max(0, base + patch.creditDelta);
    updates.credit_balance = next;
    audits.push({ action: 'adjust_credits', detail: { from: base, to: next, delta: patch.creditDelta } });
  }

  if (typeof patch.isAdmin === 'boolean' && patch.isAdmin !== current.is_admin) {
    updates.is_admin = patch.isAdmin;
    audits.push({ action: 'set_admin', detail: { from: current.is_admin, to: patch.isAdmin } });
  }

  if (Object.keys(updates).length === 0) return current; // nothing to do

  const { data: after, error: writeErr } = await supabase
    .from('users')
    .update(updates)
    .eq('id', targetId)
    .select(SELECT_COLS)
    .maybeSingle();
  if (writeErr || !after) {
    throw Object.assign(new Error('Could not update the account'), { statusCode: 500, cause: writeErr });
  }

  // Audit is best-effort: the change already landed, and losing the log entry
  // must not turn a successful update into an error for the admin.
  const { error: auditErr } = await supabase.from('admin_actions').insert(
    audits.map((a) => ({
      actor_id: actorId,
      target_user_id: targetId,
      action: a.action,
      detail: a.detail,
    })),
  );
  if (auditErr) console.error(`[admin] audit write failed for ${targetId}:`, auditErr);

  return after as unknown as AdminUserRow;
}
