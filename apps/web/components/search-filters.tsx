"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import {
  ALL,
  DEFAULT_SORT,
  LOCATION_OPTIONS,
  SECTOR_OPTIONS,
  SORT_OPTIONS,
  type SearchFiltersState,
  type SortOption,
} from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SearchFiltersProps = SearchFiltersState;

/**
 * Small client component that reflects the current filters and writes changes
 * back to the URL. The server component reads those params and fetches data —
 * there is no client-side data fetching.
 */
export function SearchFilters({ q, location, sector, sort }: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  // Local mirror of the text input; committed to the URL on submit.
  const [query, setQuery] = React.useState(q);
  React.useEffect(() => setQuery(q), [q]);

  const commit = React.useCallback(
    (patch: Partial<SearchFiltersState>) => {
      const params = new URLSearchParams(searchParams.toString());

      const setOrDelete = (key: string, value: string, isDefault: boolean) => {
        if (!value || isDefault) params.delete(key);
        else params.set(key, value);
      };

      if (patch.q !== undefined) setOrDelete("q", patch.q.trim(), false);
      if (patch.location !== undefined)
        setOrDelete("location", patch.location, patch.location === ALL);
      if (patch.sector !== undefined)
        setOrDelete("sector", patch.sector, patch.sector === ALL);
      if (patch.sort !== undefined)
        setOrDelete("sort", patch.sort, patch.sort === DEFAULT_SORT);

      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `/search?${qs}` : "/search", { scroll: false });
      });
    },
    [router, searchParams]
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit({ q: query });
      }}
      className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"
      aria-busy={isPending}
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search companies by name"
            aria-label="Search companies by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 rounded-xl pl-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
          <Select
            value={location}
            onValueChange={(next) => commit({ location: next })}
          >
            <SelectTrigger
              aria-label="Filter by location"
              className="h-11 w-full rounded-xl lg:w-40"
            >
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All locations</SelectItem>
              {LOCATION_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sector}
            onValueChange={(next) => commit({ sector: next })}
          >
            <SelectTrigger
              aria-label="Filter by sector"
              className="h-11 w-full rounded-xl lg:w-40"
            >
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sectors</SelectItem>
              {SECTOR_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sort}
            onValueChange={(next) => commit({ sort: next as SortOption })}
          >
            <SelectTrigger
              aria-label="Sort results"
              className="col-span-2 h-11 w-full rounded-xl sm:col-span-1 lg:w-56"
            >
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="submit"
            className="col-span-2 h-11 rounded-xl sm:col-span-3 lg:col-span-1 lg:w-auto lg:px-6"
          >
            <Search className="size-4" />
            Search
          </Button>
        </div>
      </div>
    </form>
  );
}
