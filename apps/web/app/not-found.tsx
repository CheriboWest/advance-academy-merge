import Link from "next/link";
import { Compass } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer className="flex justify-center">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="size-7" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t find the page you were looking for. It may have moved
          or never existed.
        </p>
        <Button asChild className="mt-6 w-full rounded-xl">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
