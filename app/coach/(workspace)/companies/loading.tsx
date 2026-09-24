export default function CompaniesLoading() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="h-11 w-full max-w-md animate-pulse rounded-lg bg-muted" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border/60 px-4 py-4 last:border-0"
          >
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-6 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
