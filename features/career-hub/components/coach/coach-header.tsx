"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { signOutAction } from "@/app/coach/actions";
import { coachNavItems } from "@/features/career-hub/components/coach/coach-nav";
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
    <div className="border-b border-border pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
          <div>
            <p className="label-caps">Coach workspace</p>
            <h1 className="mt-1 text-3xl leading-none">
              {titleForPath(pathname)}
            </h1>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <span className="truncate text-sm text-muted-foreground" title={email}>
            {email}
          </span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {menuOpen && (
        <nav className="mt-4 flex flex-col gap-1 border-t border-border pt-3 md:hidden">
          {coachNavItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                  active
                    ? "bg-secondary font-medium text-primary"
                    : "text-muted-foreground hover:text-primary"
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
