import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  ExternalLink,
  Globe,
  MapPin,
} from "lucide-react";

import { fetchActiveJobs, fetchCompanyBySlug } from "@/lib/queries";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
    <PageContainer className="max-w-4xl space-y-8">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
      >
        <Link href="/search">
          <ArrowLeft className="size-4" />
          Back to search
        </Link>
      </Button>

      {/* Company header */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {company.sector && (
                  <Badge variant="secondary" className="rounded-full">
                    {company.sector}
                  </Badge>
                )}
                <Badge variant="outline" className="rounded-full">
                  Public
                </Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {company.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" />
                  {location}
                </span>
                <span className="flex items-center gap-1.5">
                  <Briefcase className="size-4" />
                  {jobs.length} open {jobs.length === 1 ? "job" : "jobs"}
                </span>
              </div>
            </div>
            <LeadScoreBadge score={company.lead_score ?? 0} />
          </div>

          {(company.website || company.careers_url) && (
            <div className="flex flex-col gap-3 sm:flex-row">
              {company.website && (
                <Button asChild className="rounded-xl">
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
              {company.careers_url && (
                <Button asChild variant="outline" className="rounded-xl">
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
            </div>
          )}
        </div>
      </section>

      {/* Open jobs */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Open jobs</h2>
          <Separator className="flex-1" />
          <span className="text-sm text-muted-foreground tabular-nums">
            {jobs.length}
          </span>
        </div>

        {jobs.length > 0 ? (
          <ul className="space-y-3">
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
  );
}
