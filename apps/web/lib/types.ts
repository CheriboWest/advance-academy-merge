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

/**
 * A company returned by Job Role Search: a company summary plus the number of
 * that company's active jobs whose title matched the searched role. Kept
 * conceptually separate from `open_jobs` (total active jobs).
 */
export interface CompanyRoleResult extends CompanySummary {
  matching_jobs: number;
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

/**
 * The coach-facing sponsorship status for one company, from
 * GET /sponsors/companies/{id}. One of five normalized states; see
 * apps/api/app/schemas.py CompanySponsorshipStatus for the full contract
 * (in particular why `licensed` needs no `stale` check while the others do).
 */
export type SponsorshipStatus =
  | "licensed"
  | "ambiguous"
  | "no_match"
  | "error"
  | "not_checked";

export interface SponsorshipMatch {
  organisation_name: string;
  town_city: string | null;
  county: string | null;
  type_rating: string | null;
  licence_type: string | null;
  rating: string | null;
  routes: string[];
  confidence: number;
}

export interface CompanySponsorshipStatus {
  company_id: string;
  status: SponsorshipStatus;
  checked_at: string | null;
  register_import_id: string | null;
  candidate_count: number | null;
  stale: boolean;
  match: SponsorshipMatch | null;
}

/** Aggregated data for the coach dashboard. */
export interface CoachDashboardData {
  totalCompanies: number;
  highScoreCompanies: number;
  totalActiveJobs: number;
  recentCompanies: CompanySummary[];
  topHiringCompanies: CompanySummary[];
}
