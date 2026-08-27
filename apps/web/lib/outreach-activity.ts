import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCoachUser, getCompanyNames } from "@/lib/coach";
import { getContactsForCompanies } from "@/lib/contacts";
import type {
  OutreachActivityRow,
  OutreachDisplayStatus,
  OutreachEmail,
  OutreachStoredStatus,
} from "@/lib/types";

const STORED_STATUSES: readonly OutreachStoredStatus[] = [
  "draft",
  "sent",
  "replied",
  "closed",
];

function toStoredStatus(value: string): OutreachStoredStatus {
  return (STORED_STATUSES as readonly string[]).includes(value)
    ? (value as OutreachStoredStatus)
    : "sent"; // any legacy/unexpected value on an already-sent row reads as "sent"
}

/**
 * "follow_up_due" is never written to the database — it is this computed
 * state: a sent (not yet replied/closed) row whose follow_up_at has passed.
 * Kept as a pure function (no Date.now() surprises) so the dashboard's
 * filter and each row's badge can never disagree about which rows are due.
 */
export function computeDisplayStatus(row: {
  status: string;
  follow_up_at: string | null;
}): OutreachDisplayStatus {
  const stored = toStoredStatus(row.status);
  if (stored === "sent" && row.follow_up_at && new Date(row.follow_up_at) <= new Date()) {
    return "follow_up_due";
  }
  return stored;
}

function toActivityRow(
  email: OutreachEmail,
  companyNames: Record<string, string>,
  contactsById: Map<string, { full_name: string; job_title: string | null }>
): OutreachActivityRow {
  const contact = email.contact_id ? contactsById.get(email.contact_id) : undefined;
  return {
    id: email.id,
    companyId: email.company_id,
    companyName: companyNames[email.company_id] ?? "Unknown company",
    contactId: email.contact_id,
    contactName: contact?.full_name ?? null,
    contactRole: contact?.job_title ?? null,
    recipientEmail: email.recipient_email,
    subject: email.subject,
    storedStatus: toStoredStatus(email.status),
    displayStatus: computeDisplayStatus(email),
    sentAt: email.sent_at,
    lastContactedAt: email.last_contacted_at,
    followUpAt: email.follow_up_at,
    notes: email.notes,
  };
}

/**
 * Every outreach attempt the current coach has actually sent — drafts are
 * deliberately excluded (this is a *sent*-outreach tracker, per the "after
 * an email is sent" framing; unsent drafts stay on the composer page where
 * they're being written). Most recently contacted first.
 *
 * Company names come from the public, openly-readable company summary;
 * contact names come from GET /contacts (batched across every company
 * involved) since the `contacts` table itself is service-role-only and
 * can't be read directly even with RLS (see migration 0011) — neither is
 * duplicated here, both are looked up fresh each call.
 */
export async function getOutreachActivities(): Promise<OutreachActivityRow[]> {
  const claims = await getCoachUser();
  if (!claims) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("outreach_emails")
    .select("*")
    .eq("coach_user_id", claims.sub)
    .neq("status", "draft")
    .order("last_contacted_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  const emails = (data ?? []) as OutreachEmail[];
  return enrichActivityRows(emails);
}

/** One company's outreach history, for its Sponsored Company / Outreach
 *  pages — same exclusion and enrichment as getOutreachActivities, scoped
 *  to a single company_id. */
export async function getOutreachActivitiesForCompany(
  companyId: string
): Promise<OutreachActivityRow[]> {
  const claims = await getCoachUser();
  if (!claims) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("outreach_emails")
    .select("*")
    .eq("coach_user_id", claims.sub)
    .eq("company_id", companyId)
    .neq("status", "draft")
    .order("last_contacted_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  const emails = (data ?? []) as OutreachEmail[];
  return enrichActivityRows(emails);
}

async function enrichActivityRows(
  emails: OutreachEmail[]
): Promise<OutreachActivityRow[]> {
  if (emails.length === 0) return [];

  const companyIds = [...new Set(emails.map((email) => email.company_id))];
  const [companyNames, contacts] = await Promise.all([
    getCompanyNames(companyIds),
    getContactsForCompanies(companyIds),
  ]);

  const contactsById = new Map(
    contacts.map((contact) => [
      contact.id,
      { full_name: contact.full_name, job_title: contact.job_title },
    ])
  );

  return emails.map((email) => toActivityRow(email, companyNames, contactsById));
}
