import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, ExternalLink, Globe, MapPin } from "lucide-react";

import { fetchActiveJobs, fetchCompanyBySlug } from "@/lib/queries";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { JobItem } from "@/components/job-item";
import { EmptyState } from "@/components/empty-state";

// Company and job data are fetched per request from Supabase.
export const dynamic = "force-dynamic";

interface CompanyPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: CompanyPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const company = await fetchCompanyBySlug(slug);
    if (!company) {
      return { title: "Company not found" };
    }
    return { title: company.name };
  } catch {
    return { title: "Company" };
  }
}

export default async function CompanyPage({ params }: CompanyPageProps) {
  const { slug } = await params;

  const company = await fetchCompanyBySlug(slug);
  if (!company) {
    notFound();
  }

  const jobs = await fetchActiveJobs(company.id);
  const location = company.hq_location ?? company.region ?? "—";

  return (
    <>
      <PageContainer width="prose" className="py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/search">
            <ArrowLeft className="size-4" />
            Back to search
          </Link>
        </Button>

        {/* Company masthead */}
        <header className="mt-6 border-b-2 border-foreground pb-8">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              {company.sector && (
                <Badge variant="outline">{company.sector}</Badge>
              )}
              <h1 className="mt-3 text-balance text-4xl leading-[1.02] sm:text-6xl">
                {company.name}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" />
                  {location}
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Briefcase className="size-4" />
                  {jobs.length} open {jobs.length === 1 ? "job" : "jobs"}
                </span>
              </div>
            </div>
            <LeadScoreBadge score={company.lead_score ?? 0} className="shrink-0" />
          </div>

          {(company.website || company.careers_url) && (
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {company.careers_url && (
                <Button asChild size="xl" className="hidden sm:inline-flex">
                  <a
                    href={company.careers_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-4" />
                    Careers page
                  </a>
                </Button>
              )}
              {company.website && (
                <Button
                  asChild
                  size="xl"
                  variant={company.careers_url ? "outline" : "default"}
                >
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="size-4" />
                    Visit website
                  </a>
                </Button>
              )}
            </div>
          )}
        </header>

        {/* Open jobs */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
            <h2 className="text-2xl">Open jobs</h2>
            <span className="label-caps tabular-nums">{jobs.length} live</span>
          </div>

          {jobs.length > 0 ? (
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobItem job={job} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No open jobs right now"
              description="This company doesn't have any live roles at the moment. Check back soon or visit their careers page."
            />
          )}
        </section>
      </PageContainer>

      {/* The money action, pinned within thumb reach on mobile. */}
      {company.careers_url && (
        <div className="sticky bottom-0 z-30 border-t border-border bg-background p-3 sm:hidden">
          <Button asChild size="xl" className="w-full">
            <a
              href={company.careers_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              Careers page
            </a>
          </Button>
        </div>
      )}
    </>
  );
}
