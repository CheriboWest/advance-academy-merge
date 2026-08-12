"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass } from "lucide-react";

import { cn } from "@/lib/utils";
import { coachNavItems } from "@/components/coach/coach-nav";

/** Desktop-only vertical navigation rail for the coach workspace. */
export function CoachSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-24 flex flex-col gap-6 rounded-3xl border border-border bg-card p-4 shadow-sm">
        <Link
          href="/coach/dashboard"
          className="flex items-center gap-2 px-2 py-1 font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Compass className="size-5" />
          </span>
          <span>Coach</span>
        </Link>

        <nav className="flex flex-col gap-1">
          {coachNavItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  active && "bg-primary/10 text-primary hover:bg-primary/15"
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
