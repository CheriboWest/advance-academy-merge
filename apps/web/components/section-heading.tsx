import { cn } from "@/lib/utils";

/** Numbered section eyebrow: gold ordinal, navy small-caps label. */
export function SectionHeading({
  index,
  children,
  className,
}: {
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("flex items-baseline gap-2", className)}>
      <span className="text-[11px] font-semibold tabular-nums text-highlight-ink">
        {String(index).padStart(2, "0")}
      </span>
      <span className="label-caps">{children}</span>
    </p>
  );
}
