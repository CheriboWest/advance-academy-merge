import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer width="prose" className="py-24">
      <div className="card-surface px-6 py-14 text-center sm:px-12">
        <span className="icon-tile mx-auto">
          <Compass className="size-5" />
        </span>
        <p className="label-caps mt-5">Error 404</p>
        <h1 className="mt-3 text-5xl sm:text-6xl">Page not found</h1>
        <p className="mx-auto mt-5 max-w-md text-muted-foreground">
          We couldn&apos;t find the page you were looking for. It may have moved
          or never existed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild variant="highlight" size="lg">
            <Link href="/">
              Back to home
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/search">Search employers</Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
