"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { coachNavItems } from "@/components/coach/coach-nav";

/** Desktop-only vertical navigation rail for the coach workspace. */
export function CoachSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border md:block">
      <div className="sticky top-16 py-8 pr-6">
        <Link href="/coach/dashboard" className="block">
          <span className="label-caps">Workspace</span>
          <span className="mt-1 block font-display text-2xl leading-none">
            Coach
          </span>
        </Link>

        <nav className="mt-8 flex flex-col">
          {coachNavItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 border-l-2 py-2.5 pl-3 text-sm transition-colors",
                  active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
