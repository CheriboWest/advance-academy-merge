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
  apply_url?: string | null;
  url?: string | null;
}
