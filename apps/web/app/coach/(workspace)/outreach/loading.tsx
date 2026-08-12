export default function OutreachLoading() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-52 animate-pulse rounded-3xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
