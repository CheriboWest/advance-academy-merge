import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase.js';

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

export interface LeadRow {
  id: string;
  email: string;
  name: string | null;
  source: string;
  readiness_score: number | null;
  consent_marketing: boolean;
  double_optin: boolean;
  status: string;
  created_at: string;
}

/** Admin list (auth-gated in the route). Newest first, capped. */
export async function listLeads(opts: { status?: string; source?: string; limit?: number } = {}): Promise<LeadRow[]> {
  const supabase = getSupabase();
  let q = supabase
    .from(TABLE)
    .select('id, email, name, source, readiness_score, consent_marketing, double_optin, status, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 500, 2000));
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.source) q = q.eq('source', opts.source);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('List failed'), { statusCode: 500, cause: error });
  return (data ?? []) as LeadRow[];
}

/**
 * Send the double-opt-in confirmation email.
 *
 * Bước 5 wires a real provider (Resend / Google SMTP). Until EMAIL_API_KEY is set
 * we log the link so the whole pipe is testable end-to-end without a provider.
 */
export async function sendConfirmEmail(email: string, token: string): Promise<void> {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const confirmUrl = `${base}/api/leads/confirm?token=${encodeURIComponent(token)}`;

  if (!process.env.EMAIL_API_KEY?.trim()) {
    console.log(`[leads] (no EMAIL_API_KEY) confirm link for ${email}: ${confirmUrl}`);
    return;
  }
  // TODO (Bước 5): call the transactional email provider here.
  console.log(`[leads] TODO send confirm email to ${email}: ${confirmUrl}`);
}
