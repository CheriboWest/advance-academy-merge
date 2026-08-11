"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { locations, sectors } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SortOption = "score-desc" | "jobs-desc" | "name-asc";

export interface SearchFiltersValue {
  query: string;
  location: string; // "all" or a specific location
  sector: string; // "all" or a specific sector
  sort: SortOption;
}

export const defaultFilters: SearchFiltersValue = {
  query: "",
  location: "all",
  sector: "all",
  sort: "score-desc",
};

const sortLabels: Record<SortOption, string> = {
  "score-desc": "Lead score (high to low)",
  "jobs-desc": "Most open jobs",
  "name-asc": "Company name (A–Z)",
};

interface SearchFiltersProps {
  value: SearchFiltersValue;
  onChange: (value: SearchFiltersValue) => void;
  /** Called when the search button is pressed or the input is submitted. */
  onSearch?: () => void;
}

export function SearchFilters({
  value,
  onChange,
  onSearch,
}: SearchFiltersProps) {
  function update<K extends keyof SearchFiltersValue>(
    key: K,
    next: SearchFiltersValue[K]
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch?.();
      }}
      className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search companies by name or keyword"
            aria-label="Search companies"
            value={value.query}
            onChange={(event) => update("query", event.target.value)}
            className="h-11 rounded-xl pl-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
          <Select
            value={value.location}
            onValueChange={(next) => update("location", next)}
          >
            <SelectTrigger
              aria-label="Filter by location"
              className="h-11 w-full rounded-xl lg:w-40"
            >
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location} value={location}>
                  {location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={value.sector}
            onValueChange={(next) => update("sector", next)}
          >
            <SelectTrigger
              aria-label="Filter by sector"
              className="h-11 w-full rounded-xl lg:w-40"
            >
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sectors</SelectItem>
              {sectors.map((sector) => (
                <SelectItem key={sector} value={sector}>
                  {sector}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={value.sort}
            onValueChange={(next) => update("sort", next as SortOption)}
          >
            <SelectTrigger
              aria-label="Sort results"
              className="col-span-2 h-11 w-full rounded-xl sm:col-span-1 lg:w-56"
            >
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {sortLabels[option]}
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
