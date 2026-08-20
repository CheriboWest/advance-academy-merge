import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Building2, Flame, MapPin, TrendingUp } from "lucide-react";

import { getDashboardData } from "@/lib/coach";
import { KPICard } from "@/components/coach/kpi-card";
import { CompanyRow } from "@/components/company-row";
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
      <section className="grid grid-cols-1 border-y border-border sm:grid-cols-2 sm:divide-x sm:divide-border lg:grid-cols-4">
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
        <h2 className="border-b-2 border-foreground pb-3 text-2xl">
          Top hiring companies
        </h2>

        {data.topHiringCompanies.length > 0 ? (
          <ol className="divide-y divide-border">
            {data.topHiringCompanies.map((company, index) => (
              <li key={company.id}>
                <Link
                  href={`/companies/${company.slug}`}
                  className="group flex items-center gap-4 border-l-2 border-transparent py-4 pl-3 transition-[background-color,border-color,padding] hover:border-l-primary hover:bg-muted hover:pl-5"
                >
                  <span className="font-display text-xl tabular-nums text-muted-foreground">
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
        <h2 className="border-b-2 border-foreground pb-3 text-2xl">
          Recent companies
        </h2>

        {data.recentCompanies.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.recentCompanies.map((company) => (
              <li key={company.id}>
                <CompanyRow company={company} />
              </li>
            ))}
          </ul>
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
