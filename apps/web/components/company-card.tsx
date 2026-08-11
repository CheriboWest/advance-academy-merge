"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Briefcase, Globe, MapPin } from "lucide-react";

import type { CompanySummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadScoreBadge } from "@/components/lead-score-badge";

interface CompanyCardProps {
  company: CompanySummary;
}

/** Strip the protocol from a URL for a cleaner display label. */
function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function CompanyCard({ company }: CompanyCardProps) {
  const location = company.hq_location ?? company.region ?? "—";
  const openJobs = company.open_jobs ?? 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className="group flex h-full flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold leading-tight tracking-tight">
              {company.name}
            </h3>
            {company.sector && (
              <Badge variant="secondary" className="rounded-full font-normal">
                {company.sector}
              </Badge>
            )}
          </div>
          <LeadScoreBadge score={company.lead_score ?? 0} />
        </div>

        <dl className="grid gap-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="size-4 shrink-0" />
            <span>{location}</span>
          </div>
          {company.website && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Globe className="size-4 shrink-0" />
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate underline-offset-4 hover:text-foreground hover:underline"
              >
                {displayHost(company.website)}
              </a>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Briefcase className="size-4 shrink-0" />
            <span>
              {openJobs} open {openJobs === 1 ? "job" : "jobs"}
            </span>
          </div>
        </dl>
      </div>

      <Button asChild className="w-full rounded-xl">
        <Link href={`/companies/${company.slug}`}>
          View
          <ArrowUpRight className="size-4" />
        </Link>
      </Button>
    </motion.article>
  );
}
