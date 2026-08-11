import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Construction, LockKeyhole } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Coach login",
  description: "The private coach workspace for CareerHub UK.",
};

export default function CoachLoginPage() {
  return (
    <PageContainer className="flex justify-center">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockKeyhole className="size-7" />
        </span>

        <Badge variant="secondary" className="mt-5 rounded-full gap-1">
          <Construction className="size-3" />
          Coming soon
        </Badge>

        <h1 className="mt-4 text-2xl font-bold tracking-tight">Coach login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The private coach workspace — lead scoring, outreach tracking, and
          student management — is on its way. Authentication will be enabled in
          a future milestone.
        </p>

        <Button asChild variant="outline" className="mt-6 w-full rounded-xl">
          <Link href="/">
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </Button>
      </div>
    </PageContainer>
  );
}
