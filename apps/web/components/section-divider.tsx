import { cn } from "@/lib/utils";

/** Hairline rule broken by a centred gold ring — the concept's section break. */
export function SectionDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)} aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="flex size-3.5 items-center justify-center rounded-full border-2 border-highlight">
        <span className="size-1 rounded-full bg-highlight" />
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
