import type { PersonActivity, PersonEvent } from '@advance-academy/contracts';

/**
 * Turning three unrelated tables into one answer to "is this person engaged?".
 *
 * Tool runs, interview sessions and coaching bookings each have their own table,
 * their own timestamp column and their own idea of what a row means. The admin
 * screen needs them as one list, newest first, plus the two or three numbers a
 * coach actually decides on. All of that is arithmetic over rows, so it lives
 * here as pure functions rather than inside the Supabase calls.
 */

/** How many events the drawer shows. Enough to see a pattern, not a full audit. */
const TIMELINE_LIMIT = 40;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Merge event sources into one newest-first list.
 *
 * Rows with no usable timestamp are dropped rather than sorted to one end: an
 * event we cannot place in time tells a coach nothing, and letting `Invalid Date`
 * through would silently reorder everything around it.
 */
export function mergeTimeline(sources: PersonEvent[][]): PersonEvent[] {
  return sources
    .flat()
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Reduce a merged timeline to the summary the list and drawer show.
 *
 * `now` is a parameter, not `Date.now()`, so "events in the last 30 days" can be
 * tested at all — and so a single read reports one consistent cut-off across
 * every field rather than drifting between them.
 */
export function summariseActivity(timeline: PersonEvent[], now: number): PersonActivity {
  const cutoff = now - THIRTY_DAYS_MS;
  const byTool: Record<string, number> = {};

  let events30d = 0;
  for (const event of timeline) {
    if (Date.parse(event.at) >= cutoff) events30d += 1;
    if (event.kind === 'tool') {
      byTool[event.detail] = (byTool[event.detail] ?? 0) + 1;
    }
  }

  return {
    // Already sorted newest-first, so the ends of the list are the extremes.
    lastActiveAt: timeline[0]?.at ?? null,
    firstActiveAt: timeline[timeline.length - 1]?.at ?? null,
    totalEvents: timeline.length,
    events30d,
    byTool,
    // Counts above are over everything; only the visible list is capped, so a
    // heavy user's totals stay honest.
    timeline: timeline.slice(0, TIMELINE_LIMIT),
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The company an interview session was about.
 *
 * `context_json` is a snapshot written by the interview service and its shape is
 * not enforced by any type at the database boundary, so it is probed rather than
 * trusted. Falling back to the persona keeps the row identifiable when the
 * snapshot predates the field.
 */
export function interviewLabel(row: {
  context_json?: unknown;
  persona_id?: string | null;
  status?: string | null;
}): string {
  const ctx = row.context_json;
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    const c = ctx as Record<string, unknown>;
    const company = str(c.companyName) ?? str(c.company_name) ?? str(c.company);
    const role = str(c.targetRole) ?? str(c.target_role) ?? str(c.role);
    if (company && role) return `${role} · ${company}`;
    if (company) return company;
    if (role) return role;
  }
  return str(row.persona_id) ?? 'Interview session';
}
