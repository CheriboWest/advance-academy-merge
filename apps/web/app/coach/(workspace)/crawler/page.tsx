"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Gauge,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getCrawlHistory,
  getCrawlStatus,
  startCrawl,
  type CrawlRunStatus,
  type StartCrawlResponse,
} from "@/lib/crawler-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/coach/kpi-card";

const SOURCE_OPTIONS = [
  { key: "adzuna", label: "Adzuna" },
  { key: "reed", label: "Reed" },
] as const;

type Phase =
  | "idle"
  | "cached"
  | "cached-accepted"
  | "running"
  | "done"
  | "error";

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CrawlerPage() {
  const [query, setQuery] = React.useState("");
  const [city, setCity] = React.useState("");
  const [sources, setSources] = React.useState<Record<string, boolean>>({
    adzuna: true,
    reed: true,
  });
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [cached, setCached] = React.useState<StartCrawlResponse | null>(null);
  const [run, setRun] = React.useState<CrawlRunStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [history, setHistory] = React.useState<CrawlRunStatus[]>([]);
  const pollTimerRef = React.useRef<number | null>(null);
  // Bumped whenever the active poll loop should be superseded. Any in-flight
  // tick whose captured generation != the current one stops instead of
  // rescheduling — this prevents overlapping loops from re-renders or from
  // starting a second crawl while the first is still polling.
  const pollGenerationRef = React.useRef(0);

  const selectedSources = Object.entries(sources)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  const loadHistory = React.useCallback(async () => {
    try {
      setHistory(await getCrawlHistory());
    } catch {
      // History is best-effort; ignore load errors.
    }
  }, []);

  // Cancel any running poll loop: clear the pending timeout and invalidate the
  // current generation so an in-flight tick won't reschedule.
  const stopPolling = React.useCallback(() => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    loadHistory();
    return () => {
      stopPolling();
    };
  }, [loadHistory, stopPolling]);

  const poll = React.useCallback(
    (runId: string) => {
      // Supersede any previous loop, then claim this generation.
      stopPolling();
      const generation = pollGenerationRef.current;
      const startedAt = Date.now();
      // Hard ceiling so a run that never reaches a terminal status (e.g. the
      // backend fails to finalize the row) can't poll forever.
      const MAX_POLL_MS = 120_000;
      const DONE = new Set(["completed", "success"]);
      const FAILED = new Set(["failed", "error"]);

      const isCurrent = () => generation === pollGenerationRef.current;

      // TEMPORARY diagnostics — remove after investigation.
      console.log(
        `[crawler-poll] loop-start run_id=${runId} generation=${generation}`
      );

      const tick = async () => {
        if (!isCurrent()) return;

        let status: CrawlRunStatus;
        try {
          status = await getCrawlStatus(runId);
        } catch (err) {
          if (!isCurrent()) return;
          stopPolling();
          setPhase("error");
          setError(
            err instanceof Error ? err.message : "Failed to poll crawl status."
          );
          return;
        }

        // A newer loop (or unmount) took over while we awaited — stop silently.
        if (!isCurrent()) return;

        // TEMPORARY diagnostics — remove after investigation.
        console.log(`[crawler-poll] run_id=${runId}`);
        console.log(`[crawler-poll] status=${status.status}`);
        console.log("[crawler-poll] response=", status);

        setRun(status);

        if (DONE.has(status.status)) {
          stopPolling();
          setPhase("done");
          loadHistory();
          return;
        }
        if (FAILED.has(status.status)) {
          stopPolling();
          setPhase("error");
          setError(status.error || "The crawl failed.");
          loadHistory();
          return;
        }

        // Still running — stop if we've exceeded the ceiling.
        if (Date.now() - startedAt > MAX_POLL_MS) {
          stopPolling();
          setPhase("error");
          setError(
            "The crawl is taking longer than expected. Please check back later."
          );
          loadHistory();
          return;
        }

        pollTimerRef.current = window.setTimeout(tick, 2000);
      };

      void tick();
    },
    [loadHistory, stopPolling]
  );

  async function begin(force: boolean) {
    // Cancel any previous poll loop before starting a new crawl action.
    stopPolling();
    setError(null);
    if (!query.trim() || !city.trim()) {
      setError("Enter a role/keyword and a city.");
      return;
    }
    if (selectedSources.length === 0) {
      setError("Select at least one source.");
      return;
    }

    setStarting(true);
    try {
      const res = await startCrawl({
        query: query.trim(),
        city: city.trim(),
        sources: selectedSources,
        force,
      });
      if (res.cached) {
        setCached(res);
        setPhase("cached");
      } else if (res.run_id) {
        setRun(null);
        setPhase("running");
        poll(res.run_id);
      }
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Failed to start the crawl.");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || phase === "running";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Job crawler</h2>
        <p className="text-sm text-muted-foreground">
          Discover companies and roles from Adzuna and Reed. Results feed the
          shared database — review companies on the{" "}
          <Link
            href="/coach/companies"
            className="text-primary underline-offset-4 hover:underline"
          >
            Companies
          </Link>{" "}
          page.
        </p>
      </header>

      {/* Form */}
      <section className="space-y-5 rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="query" className="text-sm font-medium">
              Role / keyword
            </label>
            <Input
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Software Engineer"
              disabled={busy}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="city" className="text-sm font-medium">
              City
            </label>
            <Input
              id="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="e.g. London"
              disabled={busy}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium">Sources</legend>
          <div className="flex flex-wrap gap-3">
            {SOURCE_OPTIONS.map((source) => (
              <label
                key={source.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm",
                  sources[source.key] && "border-primary/40 bg-primary/5"
                )}
              >
                <input
                  type="checkbox"
                  checked={sources[source.key] ?? false}
                  onChange={(event) =>
                    setSources((prev) => ({
                      ...prev,
                      [source.key]: event.target.checked,
                    }))
                  }
                  className="size-4 accent-primary"
                />
                {source.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && phase !== "running" && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            className="rounded-xl"
            onClick={() => begin(false)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            {busy ? "Running…" : "Run crawl"}
          </Button>
        </div>
      </section>

      {/* Cached prompt */}
      {phase === "cached" && cached && (
        <section className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold tracking-tight">
                Using cached results
              </h3>
              <p className="text-sm text-muted-foreground">
                Refreshed{" "}
                {cached.hours_ago != null
                  ? `${cached.hours_ago} hours ago`
                  : "recently"}
                . {cached.jobs_available ?? 0} jobs available in the database.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setPhase("cached-accepted")}
            >
              Use cached
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              onClick={() => begin(true)}
            >
              <RefreshCcw className="size-4" />
              Refresh now
            </Button>
          </div>
        </section>
      )}

      {/* Cached accepted */}
      {phase === "cached-accepted" && cached && (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                Using {cached.jobs_available ?? 0} cached jobs. Review the
                companies on the Companies page.
              </p>
            </div>
            <Button asChild size="sm" className="shrink-0 rounded-xl">
              <Link href="/coach/companies">
                Companies
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* Running */}
      {phase === "running" && (
        <section className="flex items-center gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <p className="font-medium">Crawling…</p>
            <p className="text-sm text-muted-foreground">
              Fetching and ingesting jobs. This can take a little while.
            </p>
          </div>
        </section>
      )}

      {/* Done — statistics only (no raw jobs) */}
      {phase === "done" && run && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold tracking-tight">
              Crawl complete
            </h3>
            <Button asChild size="sm" variant="outline" className="rounded-xl">
              <Link href="/coach/companies">
                Review companies
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          {run.error && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <TriangleAlert className="size-4 shrink-0" />
              Some sources reported issues: {run.error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KPICard label="Raw jobs" value={run.raw_jobs} icon={Briefcase} />
            <KPICard
              label="Normalized jobs"
              value={run.normalized_jobs}
              icon={Gauge}
            />
            <KPICard
              label="Inserted jobs"
              value={run.inserted_jobs}
              icon={Sparkles}
            />
            <KPICard
              label="Updated jobs"
              value={run.updated_jobs}
              icon={RefreshCcw}
            />
            <KPICard
              label="Duplicate jobs"
              value={run.duplicate_jobs}
              icon={Copy}
            />
            <KPICard
              label="Companies created"
              value={run.companies_created}
              icon={Building2}
            />
            <KPICard
              label="Companies updated"
              value={run.companies_updated}
              icon={Building2}
            />
          </div>
        </section>
      )}

      {/* History */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold tracking-tight">Recent crawls</h3>
        {history.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border bg-card/50 px-6 py-8 text-center text-sm text-muted-foreground">
            No crawls yet. Run one above to get started.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Raw</th>
                  <th className="px-4 py-3 text-right font-medium">Inserted</th>
                  <th className="px-4 py-3 text-right font-medium">Dupes</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium">{item.query ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.location ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          item.status === "completed"
                            ? "secondary"
                            : item.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                        className="rounded-full"
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.raw_jobs}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.inserted_jobs}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.duplicate_jobs}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
