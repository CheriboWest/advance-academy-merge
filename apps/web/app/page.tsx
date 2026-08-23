import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { POPULAR_ROLES, ALL, DEFAULT_SORT } from "@/lib/filters";
import { fetchCompanies, fetchPublicStats } from "@/lib/queries";
import type { CompanySummary } from "@/lib/types";
import { PageContainer } from "@/components/page-container";
import { HeroSearch } from "@/components/hero-search";
import { CompanyCard } from "@/components/company-card";
import { SectionDivider } from "@/components/section-divider";
import { SectionHeading } from "@/components/section-heading";
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
      <PageContainer as="section" className="pt-16 text-center sm:pt-24">
        <p className="label-caps">UK graduate &amp; early-career hiring</p>

        <h1 className="mx-auto mt-5 max-w-4xl text-balance text-5xl leading-[0.95] sm:text-6xl md:text-7xl">
          Which UK companies are hiring right now
          <span className="text-highlight-ink"> — and how to reach them.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Search live roles by company or job title, see who is actually
          recruiting, and go straight to their careers page. No account needed.
        </p>

        <div className="mx-auto mt-10 max-w-2xl">
          <HeroSearch />

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <span className="label-caps mr-1">Or jump to</span>
            {POPULAR_ROLES.map((role) => (
              <Link
                key={role}
                href={`/search?mode=role&q=${encodeURIComponent(role)}`}
                className="rounded-full border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-secondary hover:text-primary"
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

      <PageContainer className="mt-16 sm:mt-20">
        <SectionDivider />
      </PageContainer>

      {hiring.length > 0 && (
        <PageContainer as="section" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionHeading index={1}>Find opportunities</SectionHeading>
              <h2 className="mt-2 text-3xl sm:text-4xl">Hiring now</h2>
            </div>
            <Button asChild variant="link" size="sm">
              <Link href="/search">
                All employers
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {hiring.map((company) => (
              <CompanyCard key={company.id} company={company} />
            ))}
          </div>
        </PageContainer>
      )}

      <PageContainer as="section" className="mt-20">
        <SectionDivider className="mb-14" />

        <div className="rounded-xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
          <h2 className="text-balance text-3xl text-primary-foreground sm:text-4xl">
            Ready to advance your career?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-primary-foreground/80">
            Start by searching employers, or find every company hiring for the
            job title you want.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="highlight" size="lg">
              <Link href="/search">Find companies</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="border border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
            >
              <Link href="/search?mode=role">Search by job role</Link>
            </Button>
          </div>
        </div>
      </PageContainer>
    </>
  );
}
