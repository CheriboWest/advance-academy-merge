import type {
  AdminPersonProfile,
  PersonAccount,
  PersonAdminAction,
  PersonEvent,
  PersonLead,
} from '@advance-academy/contracts';
import { getSupabase, isMissingColumnError } from '../lib/supabase.js';
import { contactability, readQuizResult } from '../lib/leads/lead-facts.js';
import { interviewLabel, mergeTimeline, summariseActivity } from '../lib/admin/person-activity.js';
import { toJsonQuota } from '../lib/credits.js';

/**
 * One person's full picture for /admin — the read behind the person drawer.
 *
 * Both admin tables link here with whatever id they hold, so the id may name a
 * row in `users` or in `candidate_leads`. Rather than make the caller declare
 * which, both are looked up at once (a uuid collision across two tables is not a
 * real risk) and the other half is then resolved by email.
 *
 * Email is the join key because it is the only one there is: nothing links the
 * two tables today. That is a real weakness — a lead who signs up with a
 * different address appears here as two unrelated people — and the fix is a
 * `users.lead_id` column, which is deliberately a separate piece of work.
 */

const EVENT_LIMIT = 100;

/**
 * Columns every deployed schema has.
 *
 * Anything added by a later migration goes in OPTIONAL_COLS instead, because
 * this project applies migrations by hand and a deploy can land first. On an
 * unknown-column error the read is retried with the base set only, so the drawer
 * loses a field rather than the whole person.
 */
const BASE_USER_COLS =
  'id, email, full_name, status, tier, is_admin, credit_balance, ' +
  'referral_count, first_tool_used_at, reviewed_at, created_at';
/** coaching_credits: migration 019. lead_id: migration 022. */
const OPTIONAL_USER_COLS = ['coaching_credits', 'lead_id'];

const USER_COLS = [BASE_USER_COLS, ...OPTIONAL_USER_COLS].join(', ');

const LEAD_COLS =
  'id, email, name, source, lead_magnet_id, result, consent_marketing, consent_ts, ' +
  'double_optin, utm_source, utm_medium, utm_campaign, status, created_at';

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  status: string;
  tier: string;
  is_admin: boolean;
  credit_balance: number;
  coaching_credits?: number | null;
  /** Migration 022. Undefined when the column is not there yet. */
  lead_id?: string | null;
  referral_count: number;
  first_tool_used_at: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface LeadRowRaw {
  id: string;
  email: string;
  name: string | null;
  source: string;
  lead_magnet_id: string | null;
  result: unknown;
  consent_marketing: boolean;
  consent_ts: string | null;
  double_optin: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  created_at: string;
}

function lower(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * One account, retrying without the optional columns if the schema is behind.
 *
 * `narrow` decides which row; everything else about the read is identical, which
 * is why the three lookups below share this instead of repeating the fallback.
 */
type UserQuery = PromiseLike<{ data: unknown; error: unknown }>;

async function readUser(
  run: (cols: string) => UserQuery,
): Promise<{ row: UserRow | null; error: unknown }> {
  let { data, error } = await run(USER_COLS);
  if (error && isMissingColumnError(error)) ({ data, error } = await run(BASE_USER_COLS));
  return { row: (data as UserRow | null) ?? null, error };
}

async function findUserById(id: string): Promise<UserRow | null> {
  const { row, error } = await readUser((cols) =>
    getSupabase().from('users').select(cols).eq('id', id).maybeSingle(),
  );
  if (error) {
    throw Object.assign(new Error('Could not load the account'), { statusCode: 500, cause: error });
  }
  return row;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { row, error } = await readUser((cols) =>
    getSupabase().from('users').select(cols).ilike('email', email).limit(1).maybeSingle(),
  );
  // Non-fatal: a lead is still worth showing without its account half.
  if (error) {
    console.error('[admin-person] user lookup by email failed:', error);
    return null;
  }
  return row;
}

/**
 * The account explicitly linked to this lead (migration 022).
 *
 * Tried before the email match, and it is the only lookup that survives the
 * person changing their email address after signing up.
 */
async function findUserByLeadId(leadId: string): Promise<UserRow | null> {
  const { row, error } = await readUser((cols) =>
    getSupabase().from('users').select(cols).eq('lead_id', leadId).limit(1).maybeSingle(),
  );
  if (error) {
    // Expected before migration 022; the caller falls back to email.
    if (!isMissingColumnError(error)) {
      console.error('[admin-person] user lookup by lead_id failed:', error);
    }
    return null;
  }
  return row;
}

async function findLead(by: { id?: string; email?: string }): Promise<LeadRowRaw | null> {
  const supabase = getSupabase();
  let q = supabase.from('candidate_leads').select(LEAD_COLS);
  if (by.id) q = q.eq('id', by.id);
  // A person can appear once per lead magnet; the newest capture is the one
  // whose consent state and payload are current.
  if (by.email) q = q.ilike('email', by.email);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.error('[admin-person] lead lookup failed:', error);
    return null;
  }
  return (data as unknown as LeadRowRaw) ?? null;
}

/* ── Activity sources ──────────────────────────────────────────────────────── */

async function toolEvents(userId: string): Promise<PersonEvent[]> {
  const { data, error } = await getSupabase()
    .from('tool_results')
    .select('tool, input_summary, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT);
  if (error) {
    console.error('[admin-person] tool_results failed:', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    at: r.created_at as string,
    kind: 'tool' as const,
    detail: (r.tool as string) ?? 'tool',
    label: (r.input_summary as string | null) ?? 'Tool run',
  }));
}

async function interviewEvents(userId: string): Promise<PersonEvent[]> {
  const { data, error } = await getSupabase()
    .from('interview_sessions')
    .select('status, persona_id, context_json, started_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT);
  if (error) {
    console.error('[admin-person] interview_sessions failed:', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    // started_at is the moment the person actually did something; created_at is
    // only when the row appeared, and the two differ for resumed sessions.
    at: (r.started_at as string | null) ?? (r.created_at as string),
    kind: 'interview' as const,
    detail: (r.status as string) ?? 'session',
    label: interviewLabel(r as { context_json?: unknown; persona_id?: string | null }),
  }));
}

async function coachingEvents(userId: string): Promise<PersonEvent[]> {
  const { data, error } = await getSupabase()
    .from('coaching_sessions')
    .select('status, company_name, created_at')
    .eq('student_id', userId)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT);
  if (error) {
    // Expected when migration 019 has not been applied — not worth failing the
    // whole profile over.
    console.error('[admin-person] coaching_sessions failed:', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    at: r.created_at as string,
    kind: 'coaching' as const,
    detail: (r.status as string) ?? 'session',
    label: (r.company_name as string | null) ?? 'Coaching session',
  }));
}

async function adminTrail(userId: string): Promise<PersonAdminAction[]> {
  const { data, error } = await getSupabase()
    .from('admin_actions')
    .select('action, detail, created_at')
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[admin-person] admin_actions failed:', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    at: r.created_at as string,
    action: r.action as string,
    detail: (r.detail as Record<string, unknown>) ?? {},
  }));
}

/* ── Assembly ──────────────────────────────────────────────────────────────── */

function toAccount(row: UserRow): PersonAccount {
  return {
    userId: row.id,
    status: row.status,
    tier: row.tier,
    isAdmin: row.is_admin,
    credits: row.credit_balance,
    coachingCredits: toJsonQuota(row.coaching_credits ?? 0),
    referralCount: row.referral_count,
    joinedAt: row.created_at,
    reviewedAt: row.reviewed_at,
    firstToolUsedAt: row.first_tool_used_at,
  };
}

function toLead(row: LeadRowRaw, hasAccount: boolean): PersonLead {
  const quiz = readQuizResult(row.result);
  const verdict = contactability({
    status: row.status,
    consent_marketing: row.consent_marketing,
    double_optin: row.double_optin,
    has_account: hasAccount,
  });
  return {
    leadId: row.id,
    source: row.source,
    leadMagnetId: row.lead_magnet_id,
    capturedAt: row.created_at,
    whatsapp: quiz.whatsapp,
    whatsappDigits: quiz.whatsappDigits,
    house: quiz.house,
    scoreBreakdown: quiz.scoreBreakdown,
    contactable: verdict.contactable,
    contactReason: verdict.reason,
    consentMarketing: row.consent_marketing,
    consentTs: row.consent_ts,
    doubleOptin: row.double_optin,
    status: row.status,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
  };
}

/**
 * Load one person by whichever id the calling table had.
 *
 * Throws 404 only when the id matches neither table; a person who exists on one
 * side only is a valid, expected result — that is the whole point of showing
 * leads and accounts in the same drawer.
 */
export async function getPersonProfile(id: string): Promise<AdminPersonProfile> {
  const [userById, leadById] = await Promise.all([findUserById(id), findLead({ id })]);

  let user = userById;
  let lead = leadById;

  // Fill in the half the id did not name. `users.lead_id` (migration 022) is the
  // explicit link and is tried first; the email match is the fallback for rows
  // captured before it, and for accounts created outside the funnel.
  if (user && !lead) {
    if (user.lead_id) lead = await findLead({ id: user.lead_id });
    if (!lead) {
      const email = lower(user.email);
      if (email) lead = await findLead({ email });
    }
  } else if (lead && !user) {
    user = (await findUserByLeadId(lead.id)) ?? (await findUserByEmail(lead.email));
  }

  if (!user && !lead) {
    throw Object.assign(new Error('No such person'), { statusCode: 404 });
  }

  const email = lower(user?.email) ?? lower(lead?.email) ?? '';
  const name = user?.full_name ?? lead?.name ?? null;

  // Activity and the audit trail only exist for an account. A pure lead has
  // done nothing in the product yet, by definition.
  const [tools, interviews, coaching, trail] = user
    ? await Promise.all([
        toolEvents(user.id),
        interviewEvents(user.id),
        coachingEvents(user.id),
        adminTrail(user.id),
      ])
    : [[], [], [], []];

  const activity = summariseActivity(mergeTimeline([tools, interviews, coaching]), Date.now());

  return {
    email,
    name,
    account: user ? toAccount(user) : null,
    lead: lead ? toLead(lead, Boolean(user)) : null,
    activity,
    adminTrail: trail,
  };
}
