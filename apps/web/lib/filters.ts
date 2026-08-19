/**
 * Public search filter definitions — options, defaults, and URL parsing.
 *
 * These are UI presets (not company data), so they live here rather than in any
 * mock-data module. Filters are driven entirely by URL search params so the
 * search page can render on the server for the initial load.
 */

export const LOCATION_OPTIONS = [
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Bristol",
  "Edinburgh",
  "Remote",
] as const;

export const SECTOR_OPTIONS = [
  "Technology",
  "Finance",
  "Education",
  "Retail",
  "Healthcare",
] as const;

/** Whether the text query searches company names or job roles/titles. */
export type SearchMode = "company" | "role";

export const DEFAULT_MODE: SearchMode = "company";

export type SortOption = "score_desc" | "jobs_desc" | "name_asc";

export const SORT_OPTIONS: ReadonlyArray<{ value: SortOption; label: string }> =
  [
    { value: "score_desc", label: "Lead score (high to low)" },
    { value: "jobs_desc", label: "Most open jobs" },
    { value: "name_asc", label: "Company name (A–Z)" },
  ];

export const DEFAULT_SORT: SortOption = "score_desc";

const SORT_VALUES = SORT_OPTIONS.map((option) => option.value);

/** Sentinel used for "no filter" in the URL and select components. */
export const ALL = "all";

export interface SearchFiltersState {
  q: string;
  location: string; // a LOCATION_OPTIONS value or ALL
  sector: string; // a SECTOR_OPTIONS value or ALL
  sort: SortOption;
  mode: SearchMode; // "company" (name search) or "role" (job-title search)
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse Next.js `searchParams` into a normalised, validated filter state. */
export function parseSearchFilters(params: RawSearchParams): SearchFiltersState {
  const q = (firstValue(params.q) ?? "").toString();
  const location = (firstValue(params.location) ?? ALL).toString();
  const sector = (firstValue(params.sector) ?? ALL).toString();

  const rawSort = (firstValue(params.sort) ?? DEFAULT_SORT).toString();
  const sort = (
    SORT_VALUES.includes(rawSort as SortOption) ? rawSort : DEFAULT_SORT
  ) as SortOption;

  const mode: SearchMode =
    firstValue(params.mode) === "role" ? "role" : DEFAULT_MODE;

  return { q, location, sector, sort, mode };
}
