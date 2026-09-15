import * as React from "react";

import { cn } from "@/lib/utils";

interface PageContainerProps extends React.ComponentProps<"div"> {
  as?: React.ElementType;
  /** Narrower measure for reading-heavy pages (company detail, login). */
  width?: "default" | "prose";
}

/** Centered, responsive page width wrapper with consistent horizontal padding. */
export function PageContainer({
  as: Component = "div",
  width = "default",
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <Component
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        width === "prose" ? "max-w-3xl" : "max-w-6xl",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
