import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export interface StartCrawlResponse {
  cached: boolean;
  run_id?: string;
  status?: string;
  last_refreshed_at?: string;
  hours_ago?: number;
  jobs_available?: number;
}

export interface CrawlRunStatus {
  id: string;
  status: string;
  query?: string | null;
  location?: string | null;
  // Internal counters — used by the "Recent crawls" history table.
  raw_jobs: number;
  normalized_jobs: number;
  inserted_jobs: number;
  updated_jobs: number;
  duplicate_jobs: number;
  companies_created: number;
  companies_updated: number;
  // Coach-facing metrics — used by the "Crawl complete" cards. Derived
  // server-side from the internal counters (see compute_display_stats in
  // app/crawler/models.py); companies_created above is reused as-is.
  new_jobs: number;
  duplicate_jobs_total: number;
  jobs_verified: number;
  error?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
}

export interface StartCrawlInput {
  query: string;
  city: string;
  sources: string[];
  force: boolean;
}

async function authFetch<T>(path: string, init: RequestInit): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You must be signed in to run the crawler.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (data?.detail) detail = String(data.detail);
    } catch {
      // keep default
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function startCrawl(input: StartCrawlInput): Promise<StartCrawlResponse> {
  return authFetch<StartCrawlResponse>("/discover/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCrawlStatus(runId: string): Promise<CrawlRunStatus> {
  return authFetch<CrawlRunStatus>(`/discover/status/${runId}`, {
    method: "GET",
  });
}

export function getCrawlHistory(): Promise<CrawlRunStatus[]> {
  return authFetch<CrawlRunStatus[]>("/discover/history", { method: "GET" });
}
