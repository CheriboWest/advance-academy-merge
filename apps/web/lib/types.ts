/**
 * Domain types for the public student portal, mapped to the Supabase schema.
 *
 * `CompanySummary` mirrors the `public_company_summary` SQL view (snake_case,
 * exactly as returned by PostgREST). `Job` mirrors the `jobs` table.
 */

/** A row from the `public_company_summary` view. */
export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  careers_url: string | null;
  sector: string | null;
  region: string | null;
  hq_location: string | null;
  lead_score: number | null;
  open_jobs: number | null;
}

/** A row from the `jobs` table. */
export interface Job {
  id: string;
  company_id: string;
  title: string;
  location_raw: string | null;
  city: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  is_active: boolean;
  /** Optional outbound link to the live posting, if the row provides one. */
  source_url?: string | null;
}

/**
 * A row from the `coach_company_meta` table — private, per-coach metadata for a
 * company. Protected by RLS keyed to `coach_user_id = auth.uid()`.
 */
export interface CoachCompanyMeta {
  coach_user_id: string;
  company_id: string;
  starred: boolean;
  hidden: boolean;
  notes: string | null;
}

/** A company summary merged with the current coach's private metadata. */
export interface CoachCompanyRow {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  open_jobs: number;
  lead_score: number;
  starred: boolean;
  notes: string;
}

/** A row from the `outreach_emails` table (per-coach, RLS-protected). */
export interface OutreachEmail {
  id: string;
  coach_user_id: string;
  company_id: string;
  recruiter_id: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string | null;
  created_at: string | null;
}

/** A company shown in the outreach list, plus whether a draft already exists. */
export interface OutreachCompany {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  sector: string | null;
  open_jobs: number;
  lead_score: number;
  hasDraft: boolean;
}

/** Company context shown on the composer page and fed to the generator. */
export interface OutreachCompanyContext {
  company_id: string;
  slug: string;
  name: string;
  location: string;
  sector: string | null;
  open_jobs: number;
  lead_score: number;
}

/** Aggregated data for the coach dashboard. */
export interface CoachDashboardData {
  totalCompanies: number;
  highScoreCompanies: number;
  totalActiveJobs: number;
  recentCompanies: CompanySummary[];
  topHiringCompanies: CompanySummary[];
}
