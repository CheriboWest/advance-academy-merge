/**
 * Stitching the user_engagement RPC (migration 021) onto a page of accounts.
 *
 * The RPC returns a row only for accounts that have *some* activity, so the join
 * has to treat "absent" as zero rather than as unknown — an account with no row
 * has provably done nothing, which is a real answer and the one the admin needs.
 * That asymmetry is the whole reason this is a named, tested function instead of
 * an inline `.find()`.
 */

export interface EngagementRow {
  user_id: string;
  last_active_at: string | null;
  events_30d: number | null;
  total_events: number | null;
}

export interface Engagement {
  last_active_at: string | null;
  events_30d: number;
  total_events: number;
}

/** What an account with no RPC row gets. Not null: zero is a known quantity. */
export const NO_ENGAGEMENT: Engagement = {
  last_active_at: null,
  events_30d: 0,
  total_events: 0,
};

function count(v: number | null | undefined): number {
  // Postgres `count(*)::integer` cannot be negative or fractional, but this
  // arrives as untyped JSON and a NaN here would render as "NaN" in the table.
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function indexEngagement(rows: readonly EngagementRow[] | null | undefined): Map<string, Engagement> {
  const map = new Map<string, Engagement>();
  for (const row of rows ?? []) {
    if (!row?.user_id) continue;
    map.set(row.user_id, {
      last_active_at: row.last_active_at ?? null,
      events_30d: count(row.events_30d),
      total_events: count(row.total_events),
    });
  }
  return map;
}

/**
 * Attach engagement to each account, in the list's existing order.
 *
 * Order is preserved because the caller has already sorted by signup date and
 * the RPC returns rows in whatever order the group-by produced.
 */
export function attachEngagement<T extends { id: string }>(
  users: readonly T[],
  engagement: Map<string, Engagement>,
): (T & Engagement)[] {
  return users.map((user) => ({ ...user, ...(engagement.get(user.id) ?? NO_ENGAGEMENT) }));
}
