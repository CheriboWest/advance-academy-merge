import { randomBytes } from 'node:crypto';
import { getSupabase } from '../lib/supabase.js';

/**
 * Referral loop (CA-001, ticket P3c).
 *
 * Each successful referral (an invitee who ACTIVATES — signs in via their magic
 * link) grants the inviter +2 Dream Company credits, capped at 3 referrals. The
 * grant is credited from the invitee's own authenticated activation call, so a
 * fake email that never logs in never pays out. Self-referrals are ignored.
 */

const MAX_REFERRALS = 3;
const CREDITS_PER_REFERRAL = 2;
const REFERRAL_TOOL = 'dream'; // referral rewards top up Dream Company

export interface ReferralStatus {
  code: string;
  referralCount: number;
  maxReferrals: number;
  remaining: number;
}

function genCode(): string {
  // 8 chars, url-safe, uppercase-ish. base36 of 5 random bytes.
  return randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

/** Return the user's invite code, minting one on first call. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase.from('users').select('referral_code').eq('id', userId).maybeSingle();
  if (data?.referral_code) return data.referral_code as string;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    // Set only if still null; a unique-violation means the code collided — retry.
    const { error } = await supabase
      .from('users')
      .update({ referral_code: code })
      .eq('id', userId)
      .is('referral_code', null);
    if (!error) {
      const { data: check } = await supabase
        .from('users')
        .select('referral_code')
        .eq('id', userId)
        .maybeSingle();
      if (check?.referral_code) return check.referral_code as string;
    }
  }
  throw Object.assign(new Error('Could not mint a referral code'), { statusCode: 500 });
}

export async function getReferralStatus(userId: string): Promise<ReferralStatus> {
  const supabase = getSupabase();
  const code = await getOrCreateReferralCode(userId);
  const { data } = await supabase.from('users').select('referral_count').eq('id', userId).maybeSingle();
  const referralCount = (data?.referral_count as number) ?? 0;
  return {
    code,
    referralCount,
    maxReferrals: MAX_REFERRALS,
    remaining: Math.max(0, MAX_REFERRALS - referralCount),
  };
}

/** Resolve an invite code to the inviter's user id (null if unknown). */
async function resolveReferrer(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('referral_code', code.trim().toUpperCase())
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Record who referred a freshly-created invitee. Sets `referred_by` only if not
 * already set and not a self-referral. Safe to call best-effort at signup.
 */
export async function attachReferrer(inviteeId: string, code: string | null | undefined): Promise<void> {
  const inviterId = await resolveReferrer(code);
  if (!inviterId || inviterId === inviteeId) return;
  const supabase = getSupabase();
  await supabase
    .from('users')
    .update({ referred_by: inviterId })
    .eq('id', inviteeId)
    .is('referred_by', null);
}

/**
 * Credit the inviter when the invitee activates. Idempotent: the invitee's
 * `referral_credited` flag is flipped exactly once (guarded on its current
 * value), so repeated activation calls never double-pay. If the inviter is
 * already at the cap, the invitee is still marked credited but no bonus is added.
 */
export async function creditReferralOnActivation(inviteeId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: invitee } = await supabase
    .from('users')
    .select('referred_by, referral_credited')
    .eq('id', inviteeId)
    .maybeSingle();

  const inviterId = invitee?.referred_by as string | null | undefined;
  if (!inviterId || invitee?.referral_credited || inviterId === inviteeId) return;

  // Activation = login + used at least one tool. Require a real tool use before
  // paying the inviter, so a friend who only clicks the link (or a fake email
  // that logs in but never uses anything) never earns credit.
  const { data: usageRows } = await supabase
    .from('trial_usage')
    .select('used_count')
    .eq('user_id', inviteeId);
  const usedAnyTool = (usageRows ?? []).some((r) => ((r.used_count as number) ?? 0) > 0);
  if (!usedAnyTool) return;

  // Claim the credit atomically-ish: flip false→true and require it was false.
  const { data: marked } = await supabase
    .from('users')
    .update({ referral_credited: true })
    .eq('id', inviteeId)
    .eq('referral_credited', false)
    .select('id')
    .maybeSingle();
  if (!marked) return; // already credited by a concurrent call

  const { data: inviter } = await supabase
    .from('users')
    .select('referral_count')
    .eq('id', inviterId)
    .maybeSingle();
  const count = (inviter?.referral_count as number) ?? 0;
  if (count >= MAX_REFERRALS) return; // capped — invitee credited, but no reward

  await supabase.from('users').update({ referral_count: count + 1 }).eq('id', inviterId);

  const { data: usage } = await supabase
    .from('trial_usage')
    .select('bonus_count')
    .eq('user_id', inviterId)
    .eq('tool', REFERRAL_TOOL)
    .maybeSingle();
  const nextBonus = ((usage?.bonus_count as number) ?? 0) + CREDITS_PER_REFERRAL;
  await supabase
    .from('trial_usage')
    .upsert(
      { user_id: inviterId, tool: REFERRAL_TOOL, bonus_count: nextBonus, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,tool' },
    );
}
