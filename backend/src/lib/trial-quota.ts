import { getSupabase } from './supabase.js';
import { creditReferralOnActivation } from '../services/referral.service.js';

/**
 * Trial-tier lifetime tool quotas (CA-001, ticket P2/2c).
 *
 * A quiz→passwordless lead becomes a `tier='trial'` account that may use each
 * AI tool only N LIFETIME times (see migration 013). Classroom students are
 * `tier='student'` (the DB default) and are never capped here — so this gate is
 * a no-op for everyone except the trial funnel, and it composes with (does not
 * replace) the per-day cap in rate-limit.ts.
 *
 * Counts live in `public.trial_usage`, a backend-only (service-role) table.
 */

export type TrialTool = 'cv' | 'dream' | 'interview';

const LIMITS: Record<TrialTool, { env: string; fallback: number; label: string }> = {
  // Defaults follow the locked sprint decision #5 (DC 2 · CV 1 · Interview 1).
  // Env overrides let the host retune without a redeploy.
  cv: { env: 'TRIAL_TOTAL_CV', fallback: 1, label: 'CV Optimiser' },
  dream: { env: 'TRIAL_TOTAL_DREAM', fallback: 2, label: 'Dream Company Finder' },
  interview: { env: 'TRIAL_TOTAL_INTERVIEW', fallback: 1, label: 'Interview Prep' },
};

function limitFor(tool: TrialTool): number {
  const { env, fallback } = LIMITS[tool];
  const raw = Number(process.env[env]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

async function getTier(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('tier')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('Tier lookup failed'), { statusCode: 500, cause: error });
  return data?.tier ?? null;
}

/**
 * Throw a 429-style error if a TRIAL user has spent their lifetime quota for
 * `tool`. Non-trial users (and the unauth path) pass through untouched. Call
 * this BEFORE doing the tool's expensive work.
 */
export async function assertTrialQuota(userId: string | undefined, tool: TrialTool): Promise<void> {
  if (!userId) return; // global auth already ran; nothing to gate for the rare unauth path
  if ((await getTier(userId)) !== 'trial') return;

  const supabase = getSupabase();
  const { data: usage, error } = await supabase
    .from('trial_usage')
    .select('used_count, bonus_count')
    .eq('user_id', userId)
    .eq('tool', tool)
    .maybeSingle();
  if (error) throw Object.assign(new Error('Usage lookup failed'), { statusCode: 500, cause: error });

  const used = usage?.used_count ?? 0;
  // Referral rewards (P3c) raise the effective ceiling above the base quota.
  const bonus = usage?.bonus_count ?? 0;
  if (used >= limitFor(tool) + bonus) {
    throw Object.assign(new Error(`You've used all your free ${LIMITS[tool].label} credits.`), {
      statusCode: 429,
      code: 'TRIAL_LIMIT_REACHED',
      scope: LIMITS[tool].label,
    });
  }
}

/**
 * Record one successful use of `tool` against the trial quota. No-op for
 * non-trial users. Call this AFTER the tool's work succeeds so failed runs
 * don't burn a credit.
 *
 * Read-modify-write (not atomic), which is fine: trial requests are serial per
 * user and the per-day burst cap already blocks parallel spam.
 */
export async function incrementTrialUsage(userId: string | undefined, tool: TrialTool): Promise<void> {
  if (!userId) return;
  if ((await getTier(userId)) !== 'trial') return;

  const supabase = getSupabase();
  const { data: usage } = await supabase
    .from('trial_usage')
    .select('used_count')
    .eq('user_id', userId)
    .eq('tool', tool)
    .maybeSingle();

  const prev = usage?.used_count ?? 0;
  const next = prev + 1;
  const { error } = await supabase
    .from('trial_usage')
    .upsert(
      { user_id: userId, tool, used_count: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,tool' },
    );
  if (error) throw Object.assign(new Error('Usage increment failed'), { statusCode: 500, cause: error });

  // First time this trial user touches a tool → they count as "activated", so
  // try to credit whoever referred them (self-guarded + idempotent in referral.service).
  if (prev === 0) {
    try {
      await creditReferralOnActivation(userId);
    } catch (err) {
      console.error(`[trial] referral credit on activation failed for ${userId}:`, err);
    }
  }
}
