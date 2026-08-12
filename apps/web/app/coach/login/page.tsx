import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import { getCoachUser } from "@/lib/coach";
import { PageContainer } from "@/components/page-container";
import { Badge } from "@/components/ui/badge";
import { LoginForm } from "@/app/coach/login/login-form";

export const metadata: Metadata = {
  title: "Coach login",
  description: "Sign in to the private CareerHub UK coach workspace.",
};

// Reads the session cookie, so must render dynamically.
export const dynamic = "force-dynamic";

interface CoachLoginPageProps {
  searchParams: Promise<{ redirect?: string | string[] }>;
}

export default async function CoachLoginPage({
  searchParams,
}: CoachLoginPageProps) {
  const user = await getCoachUser();
  if (user) {
    redirect("/coach/dashboard");
  }

  const { redirect: redirectParam } = await searchParams;
  const redirectTo = Array.isArray(redirectParam)
    ? redirectParam[0]
    : redirectParam;

  return (
    <PageContainer className="flex justify-center">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockKeyhole className="size-7" />
        </span>

        <Badge variant="secondary" className="mt-5 rounded-full">
          Private
        </Badge>

        <h1 className="mt-4 text-2xl font-bold tracking-tight">Coach login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to manage leads, notes, and outreach in your private
          workspace.
        </p>

        <div className="mt-6">
          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>
    </PageContainer>
  );
}
