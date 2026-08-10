import { randomUUID } from 'node:crypto';
import type { LeadRow } from '@advance-academy/contracts';
import { getSupabase } from '../lib/supabase.js';
import { sendEmail, isEmailSendingEnabled } from '../lib/email.js';
import { contactability, readQuizResult } from '../lib/leads/lead-facts.js';

/**
 * Candidate-acquisition lead-capture pipe (CA-001).
 *
 * A "lead" is a job-seeker who left their email in exchange for value from one of
 * our tools. Every lead magnet (quiz, readiness score, …) feeds the single
 * `candidate_leads` table through here. The table is backend-only (service-role);
 * the anon key can never read it (see migration 012 + the RLS note there).
 */

const TABLE = 'candidate_leads';

// Cheap shape check; the DB has the same constraint as a backstop.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());
}

export interface CaptureLeadInput {
  email: string;
  name?: string | null;
  source: string;                 // 'quiz' | 'readiness' | ...
  leadMagnetId?: string | null;
  result?: unknown;               // full report/score payload (stored as jsonb)
  readinessScore?: number | null;
  consentMarketing: boolean;      // the explicit, un-pre-ticked opt-in checkbox
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
}

export interface CaptureLeadResult {
  leadId: string;
  isNew: boolean;
  optinToken: string;
}

/**
 * Insert (or non-destructively update) a lead, keyed by (email, source).
 *
 * Re-capturing the same person from the same source does NOT create a duplicate
 * and does NOT reset an already-confirmed opt-in. A fresh token is minted only
 * when the row has none yet, so the confirm link stays stable across retries.
 */
export async function captureLead(input: CaptureLeadInput): Promise<CaptureLeadResult> {
  const supabase = getSupabase();
  const email = input.email.trim().toLowerCase();
  const source = input.source.trim();

  const { data: existing, error: selErr } = await supabase
    .from(TABLE)
    .select('id, optin_token, consent_marketing')
    .eq('email', email)
    .eq('source', source)
    .maybeSingle();
  if (selErr) throw Object.assign(new Error('Lead lookup failed'), { statusCode: 500, cause: selErr });

  const consentPatch = input.consentMarketing
    ? { consent_marketing: true, consent_ts: new Date().toISOString() }
    : {};

  if (existing) {
    const token = existing.optin_token ?? randomUUID();
    const { error: updErr } = await supabase
      .from(TABLE)
      .update({
        name: input.name ?? undefined,
        result: input.result ?? undefined,
        readiness_score: input.readinessScore ?? undefined,
        optin_token: token,
        ...consentPatch,
      })
      .eq('id', existing.id);
    if (updErr) throw Object.assign(new Error('Lead update failed'), { statusCode: 500, cause: updErr });
    return { leadId: existing.id, isNew: false, optinToken: token };
  }

  const token = randomUUID();
  const { data: inserted, error: insErr } = await supabase
    .from(TABLE)
    .insert({
      email,
      name: input.name ?? null,
      source,
      lead_magnet_id: input.leadMagnetId ?? null,
      result: input.result ?? null,
      readiness_score: input.readinessScore ?? null,
      consent_marketing: input.consentMarketing,
      consent_ts: input.consentMarketing ? new Date().toISOString() : null,
      optin_token: token,
      utm_source: input.utm?.source ?? null,
      utm_medium: input.utm?.medium ?? null,
      utm_campaign: input.utm?.campaign ?? null,
      status: 'new',
    })
    .select('id')
    .single();
  if (insErr) throw Object.assign(new Error('Lead insert failed'), { statusCode: 500, cause: insErr });

  return { leadId: inserted.id, isNew: true, optinToken: token };
}

/** Double opt-in: mark the lead confirmed when they click the email link. */
export async function confirmLead(token: string): Promise<boolean> {
  if (!token) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ double_optin: true, status: 'confirmed' })
    .eq('optin_token', token)
    .select('id')
    .maybeSingle();
  if (error) throw Object.assign(new Error('Confirm failed'), { statusCode: 500, cause: error });
  return Boolean(data);
}

/** Unsubscribe by token (List-Unsubscribe / footer link). */
export async function unsubscribeLead(token: string): Promise<boolean> {
  if (!token) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: 'unsub' })
    .eq('optin_token', token)
    .select('id')
    .maybeSingle();
  if (error) throw Object.assign(new Error('Unsubscribe failed'), { statusCode: 500, cause: error });
  return Boolean(data);
}

// One definition, shared with the admin screen — see packages/contracts.
export type { LeadRow };

/**
 * Mark which of `emails` already own an account, matched case-insensitively.
 *
 * One extra query for the whole page rather than one per row. Supabase has no
 * case-insensitive `in`, so we lower-case both sides in JS: lead emails are
 * normalised on capture, but accounts created outside the funnel may not be.
 */
async function emailsWithAccounts(emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return new Set();

  const supabase = getSupabase();
  const { data, error } = await supabase.from('users').select('email').in('email', wanted);
  if (error) {
    // Non-fatal: the lead list is still useful without the conversion column.
    console.error('[leads] account lookup failed:', error);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((r) => (r.email as string | null)?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
}

/**
 * Columns the admin list reads.
 *
 * `result` is the important addition: the quiz stores the lead's WhatsApp number
 * and career archetype in there, and while this select omitted it the admin had
 * an email address and nothing else to work with — the number was sitting in the
 * database the whole time, just never fetched.
 */
const LIST_COLS =
  'id, email, name, source, lead_magnet_id, result, readiness_score, ' +
  'consent_marketing, consent_ts, double_optin, ' +
  'utm_source, utm_medium, utm_campaign, status, created_at';

/** The row as Postgres returns it, before the derived fields are worked out. */
interface RawLeadRow {
  id: string;
  email: string;
  name: string | null;
  source: string;
  lead_magnet_id: string | null;
  result: unknown;
  readiness_score: number | null;
  consent_marketing: boolean;
  consent_ts: string | null;
  double_optin: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  created_at: string;
}

/** Admin list (auth-gated in the route). Newest first, capped. */
export async function listLeads(
  opts: { status?: string; source?: string; utmSource?: string; limit?: number } = {},
): Promise<LeadRow[]> {
  const supabase = getSupabase();
  let q = supabase
    .from(TABLE)
    .select(LIST_COLS)
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 500, 2000));
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.source) q = q.eq('source', opts.source);
  // P3a: filter by acquisition channel (utm_source, e.g. 'fb_group', 'share').
  if (opts.utmSource) q = q.eq('utm_source', opts.utmSource);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('List failed'), { statusCode: 500, cause: error });

  const rows = (data ?? []) as unknown as RawLeadRow[];
  const converted = await emailsWithAccounts(rows.map((r) => r.email));

  return rows.map((r) => {
    const has_account = converted.has(r.email?.trim().toLowerCase());
    const quiz = readQuizResult(r.result);
    const verdict = contactability({
      status: r.status,
      consent_marketing: r.consent_marketing,
      double_optin: r.double_optin,
      has_account,
    });
    // `result` itself is deliberately not forwarded: it is untyped third-party
    // jsonb, and everything the admin screen needs from it is now a named field.
    const { result: _raw, ...rest } = r;
    return {
      ...rest,
      whatsapp: quiz.whatsapp,
      whatsapp_digits: quiz.whatsappDigits,
      house: quiz.house,
      score_breakdown: quiz.scoreBreakdown,
      contactable: verdict.contactable,
      contact_reason: verdict.reason,
      has_account,
    };
  });
}

/**
 * Send the double-opt-in confirmation email (CA-001, Bước 5).
 *
 * When EMAIL_API_KEY is set we send a real email via Resend (see lib/email.ts).
 * When it's unset we log the link instead, so the whole pipe stays testable
 * end-to-end without a provider. Best-effort: sending failures are logged, never
 * thrown, so the lead-capture request that triggered this can't 500 on a mail
 * hiccup (the lead is already saved by the time we get here).
 */
export async function sendConfirmEmail(email: string, token: string): Promise<void> {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const confirmUrl = `${base}/api/leads/confirm?token=${encodeURIComponent(token)}`;

  if (!isEmailSendingEnabled()) {
    console.log(`[leads] (no EMAIL_API_KEY) confirm link for ${email}: ${confirmUrl}`);
    return;
  }

  const result = await sendEmail({
    to: email,
    subject: 'Please confirm your email — Advance Academy',
    html: buildConfirmEmailHtml(confirmUrl),
  });

  if (result.ok) {
    console.log(`[leads] confirm email sent to ${email} (id=${result.id ?? 'n/a'})`);
  } else {
    console.error(`[leads] confirm email FAILED for ${email}: ${result.error}`);
  }
}

/** Minimal, inline-styled HTML for the double-opt-in confirmation email. */
function buildConfirmEmailHtml(confirmUrl: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
            <tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px;">Confirm your email</td></tr>
            <tr><td style="font-size:14px;line-height:22px;color:#444;padding-bottom:24px;">
              Thanks for your interest in Advance Academy. Please confirm you'd like to
              receive career tips and updates from us by clicking the button below.
            </td></tr>
            <tr><td style="padding-bottom:24px;">
              <a href="${confirmUrl}" style="display:inline-block;background:#c9a84c;color:#1a1a1a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">
                Confirm my email
              </a>
            </td></tr>
            <tr><td style="font-size:12px;line-height:18px;color:#888;">
              If the button doesn't work, copy this link into your browser:<br>
              <a href="${confirmUrl}" style="color:#888;">${confirmUrl}</a>
            </td></tr>
            <tr><td style="font-size:12px;line-height:18px;color:#aaa;padding-top:24px;">
              If you didn't request this, you can safely ignore this email.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
