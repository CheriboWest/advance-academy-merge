import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Building2, Flame, MapPin, TrendingUp } from "lucide-react";

import { getDashboardData } from "@/lib/coach";
import { KPICard } from "@/components/coach/kpi-card";
import { CompanyCard } from "@/components/company-card";
import { SectionHeading } from "@/components/section-heading";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function CoachDashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-12">
      {/* Statistics band */}
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
      <section>
        <SectionHeading index={1}>Priority targets</SectionHeading>
        <h2 className="mt-2 text-2xl">Top hiring companies</h2>

        {data.topHiringCompanies.length > 0 ? (
          <ol className="mt-5 space-y-3">
            {data.topHiringCompanies.map((company, index) => (
              <li key={company.id}>
                <Link
                  href={`/companies/${company.slug}`}
                  className="card-interactive group flex items-center gap-4 p-4"
                >
                  <span className="font-display text-xl tabular-nums text-highlight-ink">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg">{company.name}</p>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {company.hq_location ?? company.region ?? "—"}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right leading-none sm:block">
                    <span className="label-caps">Open roles</span>
                    <span className="mt-1 block font-display text-2xl tabular-nums">
                      {company.open_jobs ?? 0}
                    </span>
                  </div>
                  <LeadScoreBadge
                    score={company.lead_score ?? 0}
                    className="shrink-0"
                  />
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
      <section>
        <SectionHeading index={2}>Latest additions</SectionHeading>
        <h2 className="mt-2 text-2xl">Recent companies</h2>

        {data.recentCompanies.length > 0 ? (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.recentCompanies.map((company) => (
              <li key={company.id}>
                <CompanyCard company={company} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Building2}
            title="No companies yet"
            description="Companies added to Advance Academy will show up here."
          />
        )}
      </section>
    </div>
  );
}
