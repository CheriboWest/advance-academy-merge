"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/coach/actions";
import { coachNavItems } from "@/components/coach/coach-nav";
import { Button } from "@/components/ui/button";

interface CoachHeaderProps {
  email: string;
}

function titleForPath(pathname: string): string {
  const match = coachNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  return match?.label ?? "Coach";
}

/** Top bar for the coach workspace: page title, account, and mobile nav. */
export function CoachHeader({ email }: CoachHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coach workspace
          </p>
          <h1 className="text-xl font-bold tracking-tight">
            {titleForPath(pathname)}
          </h1>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="truncate text-sm text-muted-foreground" title={email}>
          {email}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm" className="rounded-xl">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </div>

      {/* Mobile navigation drawer */}
      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-border pt-3 md:hidden">
          {coachNavItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  active && "bg-primary/10 text-primary"
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
