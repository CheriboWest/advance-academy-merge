/**
 * Shared domain types for CareerHub UK.
 *
 * Scaffold for this milestone. `apps/web` currently defines its own local
 * copies alongside its mock data so the student portal can run standalone;
 * these shared definitions become the single source of truth once the API
 * and coach workspace come online.
 */

export type UkLocation =
  | "London"
  | "Manchester"
  | "Birmingham"
  | "Leeds"
  | "Bristol"
  | "Edinburgh"
  | "Remote";

export type Sector =
  | "Technology"
  | "Finance"
  | "Education"
  | "Retail"
  | "Healthcare";

/** 0–100 outreach lead score used by the coach workspace. */
export type LeadScore = number;

export interface Company {
  id: string;
  slug: string;
  name: string;
  location: UkLocation;
  sector: Sector;
  website: string;
  careersUrl: string;
  description: string;
  leadScore: LeadScore;
}

export interface Job {
  id: string;
  companyId: string;
  title: string;
  location: UkLocation;
  salary?: string;
  postedDate: string; // ISO 8601
  url: string;
}
