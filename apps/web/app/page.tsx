import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { POPULAR_ROLES, ALL, DEFAULT_SORT } from "@/lib/filters";
import { fetchCompanies, fetchPublicStats } from "@/lib/queries";
import type { CompanySummary } from "@/lib/types";
import { PageContainer } from "@/components/page-container";
import { HeroSearch } from "@/components/hero-search";
import { CompanyRow } from "@/components/company-row";
import { Button } from "@/components/ui/button";

// Headline counts and the hiring list are read per request from Supabase.
export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("en-GB");

/**
 * Landing data is proof, not chrome: if Supabase is unreachable the hero and
 * its shortcuts must still render, so both reads collapse to nothing on error.
 */
async function loadLanding() {
  try {
    const [stats, hiring] = await Promise.all([
      fetchPublicStats(),
      fetchCompanies({
        q: "",
        location: ALL,
        sector: ALL,
        sort: DEFAULT_SORT,
        mode: "company",
      }),
    ]);
    return { stats, hiring: hiring.slice(0, 6) };
  } catch {
    return { stats: null, hiring: [] as CompanySummary[] };
  }
}

export default async function HomePage() {
  const { stats, hiring } = await loadLanding();

  return (
    <>
      <PageContainer as="section" className="pt-14 sm:pt-20">
        <p className="label-caps">UK graduate & early-career hiring</p>

        <h1 className="mt-5 max-w-4xl text-balance text-5xl leading-[0.95] sm:text-6xl md:text-7xl">
          Which UK companies are hiring right now
          <span className="text-highlight"> — and how to reach them.</span>
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Search live roles by company or job title, see who is actually
          recruiting, and go straight to their careers page. No account needed.
        </p>

        <div className="mt-10 max-w-3xl">
          <HeroSearch />

          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2">
            <span className="label-caps mr-1">Or jump to</span>
            {POPULAR_ROLES.map((role) => (
              <Link
                key={role}
                href={`/search?mode=role&q=${encodeURIComponent(role)}`}
                className="rounded-sm border border-border px-3 py-1.5 text-sm transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
              >
                {role}
              </Link>
            ))}
          </div>

          {stats && stats.companies > 0 && (
            <p className="mt-6 text-sm text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                {numberFormat.format(stats.companies)}
              </span>{" "}
              companies ·{" "}
              <span className="font-medium tabular-nums text-foreground">
                {numberFormat.format(stats.liveJobs)}
              </span>{" "}
              live roles indexed
            </p>
          )}
        </div>
      </PageContainer>

      {hiring.length > 0 && (
        <PageContainer as="section" className="mt-20">
          <div className="flex items-end justify-between gap-4 border-b-2 border-foreground pb-3">
            <h2 className="text-2xl sm:text-3xl">Hiring now</h2>
            <Button asChild variant="link" size="sm">
              <Link href="/search">
                All employers
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <ul className="divide-y divide-border">
            {hiring.map((company) => (
              <li key={company.id}>
                <CompanyRow company={company} />
              </li>
            ))}
          </ul>
        </PageContainer>
      )}
    </>
  );
}
