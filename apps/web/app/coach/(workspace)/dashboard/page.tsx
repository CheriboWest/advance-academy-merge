import type { Metadata } from "next";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  Flame,
  MapPin,
  TrendingUp,
} from "lucide-react";

import { getDashboardData } from "@/lib/coach";
import { KPICard } from "@/components/coach/kpi-card";
import { CompanyCard } from "@/components/company-card";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function CoachDashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-8">
      {/* KPIs */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Total companies"
          value={data.totalCompanies.toLocaleString("en-GB")}
          icon={Building2}
        />
        <KPICard
          label="High score (80+)"
          value={data.highScoreCompanies.toLocaleString("en-GB")}
          icon={Flame}
          hint="Priority outreach targets"
        />
        <KPICard
          label="Active jobs"
          value={data.totalActiveJobs.toLocaleString("en-GB")}
          icon={Briefcase}
        />
        <KPICard
          label="Recent companies"
          value={data.recentCompanies.length.toLocaleString("en-GB")}
          icon={TrendingUp}
          hint="Latest additions"
        />
      </section>

      {/* Top hiring companies */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Top hiring companies
          </h2>
        </div>

        {data.topHiringCompanies.length > 0 ? (
          <ol className="grid gap-3">
            {data.topHiringCompanies.map((company, index) => (
              <li key={company.id}>
                <Link
                  href={`/companies/${company.slug}`}
                  className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold tabular-nums text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{company.name}</p>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {company.hq_location ?? company.region ?? "—"}
                    </p>
                  </div>
                  <LeadScoreBadge score={company.lead_score ?? 0} />
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-lg font-semibold tabular-nums">
                      {company.open_jobs ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">open jobs</p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={Briefcase}
            title="No hiring data yet"
            description="Once companies publish open roles, your top hirers will appear here."
          />
        )}
      </section>

      {/* Recent companies */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Recent companies
        </h2>

        {data.recentCompanies.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {data.recentCompanies.map((company) => (
              <CompanyCard key={company.id} company={company} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Building2}
            title="No companies yet"
            description="Companies added to CareerHub UK will show up here."
          />
        )}
      </section>
    </div>
  );
}
