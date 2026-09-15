"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, GraduationCap, Menu, Target, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const navLinks = [
  { href: "/search", label: "Search", icon: Briefcase },
  { href: "/coach/login", label: "Coach", icon: GraduationCap },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the mobile menu whenever the route changes.
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-highlight transition-transform group-hover:scale-105">
            <Target className="size-5" />
          </span>
          <span className="font-display text-2xl leading-none text-primary">
            Advance Academy
          </span>
        </Link>

        {/* Desktop navigation — active state is a raised chip, not a rule. */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-border bg-secondary text-primary"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-primary"
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
          <span className="mx-2 h-5 w-px bg-border" />
          <ThemeToggle />
        </nav>

        {/* Mobile controls */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <nav className="border-t border-border md:hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
            {navLinks.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-secondary text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
