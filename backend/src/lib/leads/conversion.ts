/**
 * Deciding which leads converted into accounts.
 *
 * Two keys, in priority order: `users.lead_id` (migration 022) is the explicit
 * link and is trusted first; a lower-cased email match is the fallback for rows
 * captured before 022, or for an account whose email later drifted from the
 * lead's.
 *
 * Keeping both is the point. Dropping the email fallback would make every
 * pre-022 lead read as "never signed up" the moment this shipped; dropping the
 * id would leave the join resting on two strings staying equal forever.
 */

export interface LeadIdentity {
  id: string;
  email: string;
}

export interface AccountKeys {
  /** `users.lead_id` values found. Empty when migration 022 is not applied. */
  leadIds: Iterable<string | null | undefined>;
  /** `users.email` values found, any casing. */
  emails: Iterable<string | null | undefined>;
}

function normalise(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * The ids of leads that have an account.
 *
 * Returns lead ids rather than emails so the caller cannot accidentally mark two
 * different leads converted because they happen to share an address — which is
 * possible: `candidate_leads` is unique on (email, source), not on email.
 */
export function convertedLeadIds(
  leads: readonly LeadIdentity[],
  accounts: AccountKeys,
): Set<string> {
  const linked = new Set<string>();
  for (const id of accounts.leadIds) {
    if (id) linked.add(id);
  }

  const accountEmails = new Set<string>();
  for (const email of accounts.emails) {
    const e = normalise(email);
    if (e) accountEmails.add(e);
  }

  const converted = new Set<string>();
  for (const lead of leads) {
    if (!lead?.id) continue;
    if (linked.has(lead.id)) {
      converted.add(lead.id);
      continue;
    }
    const email = normalise(lead.email);
    if (email && accountEmails.has(email)) converted.add(lead.id);
  }
  return converted;
}
