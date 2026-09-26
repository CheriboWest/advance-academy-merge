import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ENGAGEMENT_TASKS,
  type EngagementMetric,
  type EngagementTask,
} from '@advance-academy/contracts/engagement';

/**
 * Pure helpers for Progress & Engagement — no I/O, so node:test covers them.
 * The Supabase reads live in services/engagement.service.ts.
 */

export type WeekCounts = Record<EngagementMetric, number>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monday 00:00 UTC of the week `now` falls in.
 * ponytail: UTC weeks, so a London student's week turns over at 00:00 or 01:00
 * local. Switch to Europe/London midnight if anyone ever notices the hour.
 */
export function weekStartUtc(now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of a UTC instant. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function taskProgress(counts: WeekCounts): EngagementTask[] {
  return ENGAGEMENT_TASKS.map((t) => {
    const progress = Math.min(counts[t.metric] ?? 0, t.target);
    return { ...t, progress, done: progress >= t.target };
  });
}

/**
 * Unsubscribe token for the reminder emails: HMAC of the user id, so the link
 * needs no stored token and can't be forged for someone else's id.
 */
export function unsubscribeToken(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`reminders:${userId}`).digest('base64url');
}

export function verifyUnsubscribeToken(userId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(unsubscribeToken(userId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Server-only secret for unsubscribe tokens. Falls back to the service-role key, which is already secret. */
export function unsubscribeSecret(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
