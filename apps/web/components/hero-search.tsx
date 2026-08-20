"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The landing page's primary conversion point: a real search box that goes
 * straight to results, rather than a button that only navigates to /search.
 */
export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const q = query.trim();
        router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
      }}
      className="flex flex-col gap-2 border-y-2 border-foreground py-2 sm:flex-row sm:items-center sm:gap-3"
    >
      <label htmlFor="hero-search" className="sr-only">
        Search UK companies by name
      </label>
      <Search className="hidden size-5 shrink-0 text-muted-foreground sm:block" />
      <input
        id="hero-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search a company, e.g. Monzo"
        className="h-12 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="xl" className="shrink-0">
        Search
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
