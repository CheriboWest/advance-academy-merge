import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { getCoachCompanies } from "@/lib/coach";
import type { CoachCompanyRow } from "@/lib/types";
import { CompaniesTable } from "@/components/coach/companies-table";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = {
  title: "Companies",
};

interface CoachCompaniesPageProps {
  searchParams: Promise<{ view?: string }>;
}

const TABS = [
  { key: "all", label: "All companies", href: "/coach/companies" },
  { key: "removed", label: "Removed", href: "/coach/companies?view=removed" },
] as const;

export default async function CoachCompaniesPage({
  searchParams,
}: CoachCompaniesPageProps) {
  const { view } = await searchParams;
  const removed = view === "removed";

  const tabs = (
    <nav className="flex gap-2 text-sm">
      {TABS.map((tab) => {
        const active = tab.key === (removed ? "removed" : "all");
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-medium transition-colors",
              active
                ? "border-primary/30 bg-secondary text-primary"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-primary"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  let rows: CoachCompanyRow[];

  try {
    rows = await getCoachCompanies({ hidden: removed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl">Companies</h2>
        </header>
        {tabs}
        <EmptyState
          icon={TriangleAlert}
          title="We couldn't load your companies"
          description={message}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {removed
            ? "Companies you removed from your list — hidden from your workspace only, and still visible to students and other coaches. Restore any to bring it back; your notes and stars are kept."
            : "Star companies and keep private notes — visible only to you. Removing a company hides it from your list; the trash button deletes it from the database for everyone."}
        </p>
      </header>
      {tabs}
      <CompaniesTable rows={rows} view={removed ? "removed" : "all"} />
    </div>
  );
}
