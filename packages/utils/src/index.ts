/**
 * Shared utilities for CareerHub UK.
 *
 * Scaffold for this milestone. A couple of small, framework-agnostic helpers
 * live here as a starting point; UI-specific helpers (such as `cn`) currently
 * live inside `apps/web/lib/utils.ts`.
 */

/** Convert a display name into a URL-safe slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Format an ISO date string as a UK-style `11 Aug 2026` label. */
export function formatUkDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
