export default function OutreachLoading() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="h-40 animate-pulse rounded-sm border border-border bg-card" />
      <div className="h-64 animate-pulse rounded-sm border border-border bg-card" />
    </div>
  );
}
