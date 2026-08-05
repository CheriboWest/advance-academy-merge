import { getSupabase } from './supabase.js';
import { creditReferralOnActivation } from '../services/referral.service.js';

/**
 * Credit wallet + tier gate — the single checkpoint for "may this user run this
 * tool, and what does it cost?" (sprint F1/F2/F3, migration 015).
 *
 * Replaces the per-tool lifetime quotas of `trial-quota.ts` (migration 013)
 * with ONE balance per user:
 *
 *   tier='trial'       2 credits, +2 per activated referral (cap 3 => 8 total)
 *   tier='membership'  20 credits, granted once on upgrade, + Interview Lab
 *   is_admin=true      unlimited, plus /admin — checked BEFORE tier everywhere
 *
 * Routes must not read `users.credit_balance` themselves; go through
 * `assertCredits` / `spendCredits` so the pricing table stays in one place.
 *
 * This composes with (does not replace) the per-day burst cap in rate-limit.ts:
 * credits stop long-run abuse, the daily cap stops same-day spam. A user hits
 * whichever comes first.
 */

export type CreditTool = 'cv' | 'dream' | 'interview';
export type Tier = 'trial' | 'membership';

/** Credit price per run. Env overrides let the host retune without a redeploy. */
const COSTS: Record<CreditTool, { env: string; fallback: number; label: string }> = {
  cv: { env: 'CREDIT_COST_CV', fallback: 1, label: 'CV Optimiser' },
  // Dream Company runs 4 sequential LLM calls — roughly 4x the spend of CV.
  dream: { env: 'CREDIT_COST_DREAM', fallback: 2, label: 'Dream Company Finder' },
  interview: { env: 'CREDIT_COST_INTERVIEW', fallback: 1, label: 'Interview Lab' },
};

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

export function costOf(tool: CreditTool): number {
  return envInt(COSTS[tool].env, COSTS[tool].fallback);
}

/** Credits handed out once when an admin upgrades someone to membership. */
export function membershipGrant(): number {
  return envInt('CREDIT_GRANT_MEMBERSHIP', 20);
}

/** Starting balance for a fresh trial account (mirrors the DB column default). */
export function trialGrant(): number {
  return envInt('CREDIT_GRANT_TRIAL', 2);
}

export interface Account {
  tier: Tier;
  isAdmin: boolean;
  credits: number;
  firstToolUsedAt: string | null;
}

export async function getAccount(userId: string): Promise<Account> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('tier, is_admin, credit_balance, first_tool_used_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error('Account lookup failed'), { statusCode: 500, cause: error });
  }
  return {
    // Fail closed on tier (an unknown row is treated as the least-privileged
    // tier) but never invent admin rights.
    tier: (data?.tier as Tier) ?? 'trial',
    isAdmin: Boolean(data?.is_admin),
    credits: (data?.credit_balance as number) ?? 0,
    firstToolUsedAt: (data?.first_tool_used_at as string | null) ?? null,
  };
}

/**
 * Throw 429 if the user can't afford `tool`. Admins always pass. Call this
 * BEFORE doing the tool's expensive work; pair it with `spendCredits` after.
 */
export async function assertCredits(userId: string | undefined, tool: CreditTool): Promise<void> {
  if (!userId) return; // global auth already ran; nothing to charge on the rare unauth path
  const account = await getAccount(userId);
  if (account.isAdmin) return;

  const cost = costOf(tool);
  if (account.credits < cost) {
    throw Object.assign(
      new Error(
        `You need ${cost} credit${cost === 1 ? '' : 's'} to run ${COSTS[tool].label} and have ${account.credits} left. Invite a friend to earn more, or upgrade to Mentorship.`,
      ),
      {
        statusCode: 429,
        code: 'CREDIT_EXHAUSTED',
        scope: COSTS[tool].label,
        cost,
        balance: account.credits,
      },
    );
  }
}

/**
 * Charge the user for one successful run of `tool`. No-op for admins. Call this
 * AFTER the work succeeds so a failed run never burns credits.
 *
 * The balance update is guarded on `credit_balance >= cost`, so a racing pair of
 * requests can't push the wallet negative — the loser simply doesn't deduct
 * (logged, not thrown: the work is already done and the user must not see an
 * error for it).
 */
export async function spendCredits(userId: string | undefined, tool: CreditTool): Promise<void> {
  if (!userId) return;
  const account = await getAccount(userId);
  if (account.isAdmin) return;

  const cost = costOf(tool);
  const isFirstUse = !account.firstToolUsedAt;
  const supabase = getSupabase();

  const { data: charged, error } = await supabase
    .from('users')
    .update({
      credit_balance: account.credits - cost,
      ...(isFirstUse ? { first_tool_used_at: new Date().toISOString() } : {}),
    })
    .eq('id', userId)
    .gte('credit_balance', cost)
    .select('credit_balance')
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error('Credit deduction failed'), { statusCode: 500, cause: error });
  }
  if (!charged) {
    // Guard rejected the write — a concurrent request spent the balance first.
    console.warn(`[credits] deduction skipped for ${userId} (${tool}): balance moved under ${cost}`);
    return;
  }

  // First tool run ever => this account counts as "activated", so pay out
  // whoever invited them (self-guarded + idempotent inside referral.service).
  if (isFirstUse) {
    try {
      await creditReferralOnActivation(userId);
    } catch (err) {
      console.error(`[credits] referral payout on activation failed for ${userId}:`, err);
    }
  }
}

/** Add credits to a wallet (referral rewards, admin top-ups). Returns the new balance. */
export async function addCredits(userId: string, amount: number): Promise<number> {
  const supabase = getSupabase();
  const { data: current } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', userId)
    .maybeSingle();
  const next = Math.max(0, ((current?.credit_balance as number) ?? 0) + amount);
  const { error } = await supabase.from('users').update({ credit_balance: next }).eq('id', userId);
  if (error) {
    throw Object.assign(new Error('Credit update failed'), { statusCode: 500, cause: error });
  }
  return next;
}

/**
 * Throw 403 unless the user is on membership (or an admin). Gates the features
 * that mentorship pays for: the Interview Lab mock session and coach booking.
 *
 * Note this gates the LIVE mock only — `interview-prep.ts` (extracting a JD from
 * a URL, listing sessions) stays open to trial users on purpose.
 */
export async function requireMembership(userId: string | undefined, feature: string): Promise<void> {
  if (!userId) return; // global auth hook already rejected anonymous callers
  const account = await getAccount(userId);
  if (account.isAdmin || account.tier === 'membership') return;

  throw Object.assign(
    new Error(`${feature} is part of Mentorship. Upgrade your account to unlock it.`),
    { statusCode: 403, code: 'MEMBERSHIP_REQUIRED', scope: feature },
  );
}
