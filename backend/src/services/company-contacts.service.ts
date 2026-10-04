import {
  contactCategory,
  type CompanyContact,
  type CompanyContactSummary,
} from '@advance-academy/contracts/contacts';
import { getSupabase } from '../lib/supabase.js';

/**
 * The student side of `public.contacts` (migration 034). Coaches manage the
 * rows through backend-python; this only reads them, with the service role,
 * because the table is closed to every client role.
 */

type ContactRow = {
  id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
};

/** Counts per category — what the locked teaser shows. No names, no titles. */
export function toSummary(rows: Array<{ job_title: string | null }>): CompanyContactSummary {
  const byCategory: CompanyContactSummary['byCategory'] = {};
  for (const row of rows) {
    const category = contactCategory(row.job_title);
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }
  return { total: rows.length, byCategory };
}

/** Explicit field list, so phone and coach notes can't ride along if the select widens. */
export function toStudentContact(row: ContactRow): CompanyContact {
  return {
    id: row.id,
    full_name: row.full_name,
    job_title: row.job_title,
    category: contactCategory(row.job_title),
    email: row.email,
    linkedin_url: row.linkedin_url,
  };
}

export async function getCompanyContactSummary(companyId: string): Promise<CompanyContactSummary> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('job_title')
    .eq('company_id', companyId);
  if (error) throw new Error(`Failed to count contacts: ${error.message}`);
  return toSummary(data ?? []);
}

export async function getCompanyContacts(companyId: string): Promise<CompanyContact[]> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('id, full_name, job_title, email, linkedin_url')
    .eq('company_id', companyId)
    .order('full_name');
  if (error) throw new Error(`Failed to load contacts: ${error.message}`);
  return (data ?? []).map(toStudentContact);
}
