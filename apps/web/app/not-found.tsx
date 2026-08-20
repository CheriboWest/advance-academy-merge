import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer width="prose" className="py-24">
      <p className="label-caps">Error 404</p>
      <h1 className="mt-4 text-5xl sm:text-6xl">Page not found</h1>
      <p className="mt-5 max-w-md text-muted-foreground">
        We couldn&apos;t find the page you were looking for. It may have moved
        or never existed.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/">
            Back to home
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/search">Search employers</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
