"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<React.ComponentProps<"input">, "type" | "checked"> {
  checked?: boolean;
  /** Renders the mixed state — some, but not all, of a group is selected. */
  indeterminate?: boolean;
}

/**
 * Native checkbox, styled with the accent colour. A native input is used rather
 * than a custom widget so keyboard interaction, form semantics, and screen
 * reader announcements (including the mixed state) come for free.
 */
function Checkbox({
  className,
  checked = false,
  indeterminate = false,
  ...props
}: CheckboxProps) {
  const ref = React.useRef<HTMLInputElement>(null);

  // `indeterminate` exists only as a DOM property, never as an attribute.
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      data-slot="checkbox"
      checked={checked}
      aria-checked={indeterminate ? "mixed" : checked}
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-sm border-input accent-primary",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Checkbox };
