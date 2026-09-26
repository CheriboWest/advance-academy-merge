import { TERMINAL_SAVED_JOB_STATUSES } from '@advance-academy/contracts/job-tracking';
import { getSupabase } from './supabase.js';
import { isEmailSendingEnabled, sendEmail } from './email.js';
import {
  addDays,
  escapeHtml,
  taskProgress,
  unsubscribeSecret,
  unsubscribeToken,
  utcDay,
  weekStartUtc,
} from './engagement.js';
import { weekCounts } from '../services/engagement.service.js';

/**
 * Reminder emails (App 1 "Reminders"). Runs in the Fastify process on the same
 * pattern as cv-analysis-reaper: once at boot, then hourly.
 *
 *   follow_ups    — from 08:00 UTC, one email on the day a tracked job's
 *                   follow-up falls due.
 *   weekly_tasks  — Friday to Sunday from 09:00 UTC, once a week, when some of
 *                   the week's tasks are still open.
 *
 * Both go out in one email when they coincide. A row in `reminder_sends` is
 * claimed BEFORE sending; its unique key is what stops a second backend
 * instance (or the next hourly pass) sending the same reminder again. A failed
 * send releases the claim so the next pass retries.
 *
 * ponytail: per-user task counts are three queries each, run once a week per
 * user. Batch them into one SQL function if the student list reaches thousands.
 */

const INTERVAL_MS = 60 * 60 * 1000;
const MAX_USERS = 5000;
let running = false;

interface Recipient {
  id: string;
  email: string;
  full_name: string | null;
}

interface DueJob {
  user_id: string;
  title: string;
  company_name: string | null;
}

async function claim(userId: string, kind: string, periodKey: string): Promise<boolean> {
  const { error } = await getSupabase().from('reminder_sends').insert({ user_id: userId, kind, period_key: periodKey });
  if (!error) return true;
  if (error.code === '23505') return false; // already sent
  throw new Error(`reminder claim failed: ${error.message}`);
}

async function release(userId: string, kind: string, periodKey: string): Promise<void> {
  await getSupabase()
    .from('reminder_sends')
    .delete()
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('period_key', periodKey);
}

function appUrl(path: string): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}

function unsubscribeUrl(userId: string, apiPath: boolean): string {
  const q = `u=${encodeURIComponent(userId)}&t=${encodeURIComponent(unsubscribeToken(userId, unsubscribeSecret()))}`;
  return appUrl(apiPath ? `/api/engagement/unsubscribe?${q}` : `/unsubscribe?${q}`);
}

function buildHtml(name: string | null, sections: string[], userId: string): string {
  const hello = name?.trim() ? `Hi ${escapeHtml(name.trim().split(/\s+/)[0])},` : 'Hi,';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <tr><td>
      <p style="margin:0 0 16px;font-size:16px;">${hello}</p>
      ${sections.join('\n')}
      <p style="margin:24px 0 0;">
        <a href="${appUrl('/')}" style="display:inline-block;background:#c9a84c;color:#1a1a1a;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">Open Advance Academy</a>
      </p>
      <p style="margin:28px 0 0;font-size:12px;color:#888;">
        You get these because reminders are on for your account.
        <a href="${unsubscribeUrl(userId, false)}" style="color:#888;">Stop reminder emails</a>.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function followUpSection(jobs: DueJob[]): string {
  const items = jobs
    .map((j) => `<li>${escapeHtml(j.title)}${j.company_name ? ` — ${escapeHtml(j.company_name)}` : ''}</li>`)
    .join('');
  return `<p style="margin:0 0 8px;font-weight:bold;">Follow up today</p>
      <ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>
      <p style="margin:0 0 16px;">A short, polite check-in keeps you on the recruiter's radar. Update the card in <a href="${appUrl('/jobs')}">your tracker</a> once it's sent.</p>`;
}

function tasksSection(
  open: Array<{
    title: string;
    progress: number;
    target: number;
    points: number;
  }>,
): string {
  const items = open
    .map((t) => `<li>${escapeHtml(t.title)} — ${t.progress}/${t.target} (+${t.points} pts)</li>`)
    .join('');
  return `<p style="margin:0 0 8px;font-weight:bold;">Still open this week</p>
      <ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>
      <p style="margin:0 0 16px;">There's still time to finish them before Sunday night.</p>`;
}

export async function runReminderPass(now = new Date()): Promise<void> {
  if (!isEmailSendingEnabled() || running) return;
  running = true;
  try {
    const sb = getSupabase();
    const today = utcDay(now);
    const hour = now.getUTCHours();
    const isoDay = ((now.getUTCDay() + 6) % 7) + 1; // Mon=1 … Sun=7
    const weekStart = weekStartUtc(now);
    const weekKey = utcDay(weekStart);

    const doFollowUps = hour >= 8;
    const doWeekly = isoDay >= 5 && hour >= 9;
    if (!doFollowUps && !doWeekly) return;

    const { data: users, error } = await sb
      .from('users')
      .select('id, email, full_name')
      .eq('status', 'approved')
      .eq('email_reminders', true)
      .limit(MAX_USERS);
    if (error) throw new Error(`reminder users: ${error.message}`);
    const recipients = ((users ?? []) as Recipient[]).filter((u) => u.email);
    if (recipients.length === 0) return;

    const dueByUser = new Map<string, DueJob[]>();
    if (doFollowUps) {
      const { data: due, error: dueErr } = await sb
        .from('saved_jobs')
        .select('user_id, title, company_name')
        .eq('next_follow_up_at', today)
        .not('status', 'in', `(${TERMINAL_SAVED_JOB_STATUSES.join(',')})`);
      if (dueErr) throw new Error(`reminder follow-ups: ${dueErr.message}`);
      for (const job of (due ?? []) as DueJob[]) {
        dueByUser.set(job.user_id, [...(dueByUser.get(job.user_id) ?? []), job]);
      }
    }

    // Skip the task queries for anyone already reminded this week.
    const alreadyWeekly = new Set<string>();
    if (doWeekly) {
      const { data: sent, error: sentErr } = await sb
        .from('reminder_sends')
        .select('user_id')
        .eq('kind', 'weekly_tasks')
        .eq('period_key', weekKey);
      if (sentErr) throw new Error(`reminder sends: ${sentErr.message}`);
      for (const row of (sent ?? []) as Array<{ user_id: string }>) alreadyWeekly.add(row.user_id);
    }

    for (const user of recipients) {
      const sections: string[] = [];
      const claimed: Array<[string, string]> = [];
      // One student's bad row must not stop everyone else's reminders.
      try {
        const due = dueByUser.get(user.id);
        if (due?.length && (await claim(user.id, 'follow_ups', today))) {
          sections.push(followUpSection(due));
          claimed.push(['follow_ups', today]);
        }

        if (doWeekly && !alreadyWeekly.has(user.id)) {
          const open = taskProgress(await weekCounts(user.id, weekStart, addDays(weekStart, 7))).filter((t) => !t.done);
          if (open.length && (await claim(user.id, 'weekly_tasks', weekKey))) {
            sections.push(tasksSection(open));
            claimed.push(['weekly_tasks', weekKey]);
          }
        }

        if (sections.length === 0) continue;
        const result = await sendEmail({
          to: user.email,
          subject: claimed.some(([kind]) => kind === 'follow_ups')
            ? 'Follow-ups due today'
            : 'Your job search this week',
          html: buildHtml(user.full_name, sections, user.id),
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl(user.id, true)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (!result.ok) throw new Error(result.error ?? 'send failed');
      } catch (err) {
        console.warn(`[reminders] ${user.id}: ${err instanceof Error ? err.message : err}`);
        await Promise.all(claimed.map(([kind, key]) => release(user.id, kind, key)));
      }
    }
  } catch (err) {
    console.error('[reminders] pass failed', err);
  } finally {
    running = false;
  }
}

/**
 * Ships dark: nothing is sent until ENGAGEMENT_REMINDERS_ENABLED=true, so a dev
 * or sandbox backend pointed at real users can't email the whole cohort by
 * accident. Same stance as LEADS_CAPTURE_ENABLED.
 */
export function startEngagementReminders(): void {
  if (process.env.ENGAGEMENT_REMINDERS_ENABLED !== 'true') return;
  void runReminderPass();
  setInterval(() => void runReminderPass(), INTERVAL_MS).unref();
}
