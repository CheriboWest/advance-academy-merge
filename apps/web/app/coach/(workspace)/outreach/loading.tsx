export default function OutreachLoading() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-sm border border-border bg-card"
        />
      ))}
    </div>
  );
}
