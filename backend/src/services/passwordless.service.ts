import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase.js';
import { attachReferrer } from './referral.service.js';

/**
 * Passwordless account + magic-link login (CA-001, ticket P2/2a).
 *
 * Delivery uses Supabase's BUILT-IN magic-link email (signInWithOtp) so the
 * product can launch without a verified email domain — Supabase's mailer sends
 * to any recipient (rate-limited). When a domain is ready, switch delivery to a
 * provider by editing only this file; nothing else depends on the mechanism.
 *
 * The trial account itself is still minted server-side:
 *   1. create a Supabase auth user with a throwaway random password (never shown;
 *      "forgot password" covers other devices), OR reuse an existing account;
 *   2. mark ONLY newly-created accounts as tier='trial' (never downgrade an
 *      existing classroom student);
 *   3. ask Supabase to email a magic login link. Clicking it logs them straight
 *      in. signInWithOtp needs the ANON key (service role is an admin context and
 *      won't dispatch the user-facing email), so we build a short-lived anon
 *      client here.
 */

function frontendBaseUrl(): string {
  const raw = (process.env.FRONTEND_URL ?? 'http://localhost:3000').split(',')[0].trim();
  return raw.replace(/\/+$/, '');
}

let anonClient: SupabaseClient | null = null;
function getAnonClient(): SupabaseClient | null {
  if (anonClient) return anonClient;
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  anonClient = createClient(url, anon, { auth: { persistSession: false } });
  return anonClient;
}

export interface PasswordlessResult {
  isNew: boolean;
  emailSent: boolean;
}

/**
 * Point an account at the lead it came from (migration 022).
 *
 * Deliberately separate from the tier update rather than folded into it: if the
 * migration has not been applied, a combined statement fails on the unknown
 * column and takes account creation down with it — which for the quiz funnel
 * means the person gets a confirm email instead of a working login. A missing
 * link is a cosmetic loss on two admin screens; a missing account is not.
 *
 * `is('lead_id', null)` means an existing account gets the link only when it has
 * none. Someone who signed up first and did the quiz later gets joined up; a
 * person who arrives through a second lead magnet keeps the lead that actually
 * produced their account.
 */
async function linkAccountToLead(userId: string, leadId?: string | null): Promise<void> {
  if (!leadId) return;
  const { error } = await getSupabase()
    .from('users')
    .update({ lead_id: leadId })
    .eq('id', userId)
    .is('lead_id', null);
  if (error) {
    console.error(`[passwordless] could not link ${userId} to lead ${leadId} — run migration 022:`, error);
  }
}

export async function createTrialAndSendMagicLink(
  email: string,
  name?: string | null,
  refCode?: string | null,
  /**
   * The lead this account came from (migration 022). Set by the quiz funnel,
   * absent for a direct sign-up on /register — those accounts genuinely have no
   * lead, and a null here says so.
   */
  leadId?: string | null,
): Promise<PasswordlessResult> {
  const supabase = getSupabase();
  const normalized = email.trim().toLowerCase();
  const redirectTo = `${frontendBaseUrl()}/auth/callback`;

  // 1) Create the auth user (random password). A duplicate-email error just means
  //    the account already exists — fine, we still send them a login link.
  let isNew = false;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: normalized,
    password: `${randomUUID()}${randomUUID()}`,
    email_confirm: true, // they prove ownership by clicking the magic link
    ...(name ? { user_metadata: { full_name: name } } : {}),
  });
  if (!createErr && created?.user) {
    isNew = true;
    // 2) Mark new accounts as trial. The on_auth_user_created trigger (migration
    //    006) already inserted the public.users row with the default tier.
    const { error: tierErr } = await supabase
      .from('users')
      .update({ tier: 'trial' })
      .eq('id', created.user.id);
    if (tierErr) {
      throw Object.assign(new Error('Failed to set trial tier'), { statusCode: 500, cause: tierErr });
    }
    await linkAccountToLead(created.user.id, leadId);
    // Record who invited this new account (best-effort; ignores self/unknown code).
    // The inviter is only rewarded later, when this user actually activates.
    if (refCode) {
      try {
        await attachReferrer(created.user.id, refCode);
      } catch (err) {
        console.error(`[passwordless] attachReferrer failed for ${normalized}:`, err);
      }
    }
  } else if (createErr) {
    // Duplicate email is expected (returning user); anything else is worth seeing.
    console.warn(`[passwordless] createUser note for ${normalized}: ${createErr.message}`);
    // Returning user who has now come through a lead magnet — someone who signed
    // up on /register first and did the quiz afterwards. Best-effort; a failed
    // lookup costs the link, not the login.
    if (leadId) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .ilike('email', normalized)
        .limit(1)
        .maybeSingle();
      if (existing?.id) await linkAccountToLead(existing.id as string, leadId);
    }
  }

  // 3) Ask Supabase to email a magic login link (built-in delivery).
  const anon = getAnonClient();
  if (anon) {
    const { error: otpErr } = await anon.auth.signInWithOtp({
      email: normalized,
      // Create on the fly if the admin.createUser step above didn't (e.g. the
      // account was cleaned up). Requires "Allow new users to sign up" = ON in
      // Supabase; otherwise GoTrue returns "Signups not allowed for otp".
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (!otpErr) {
      return { isNew, emailSent: true };
    }
    console.error(`[passwordless] Supabase magic-link send FAILED for ${normalized}: ${otpErr.message}`);
  } else {
    console.warn('[passwordless] SUPABASE_ANON_KEY not set — cannot send via Supabase; logging link instead.');
  }

  // Fallback (send failed or no anon key): generate a link and log it so local/dev
  // testing is never blocked.
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: normalized,
    options: { redirectTo },
  });
  const actionLink = linkData?.properties?.action_link;
  if (actionLink) {
    console.log(`[passwordless] fallback login link for ${normalized}: ${actionLink}`);
  }
  return { isNew, emailSent: false };
}
