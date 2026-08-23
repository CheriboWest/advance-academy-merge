import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import { getCoachUser } from "@/lib/coach";
import { PageContainer } from "@/components/page-container";
import { LoginForm } from "@/app/coach/login/login-form";

export const metadata: Metadata = {
  title: "Coach login",
  description: "Sign in to the private Advance Academy coach workspace.",
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
    <PageContainer className="max-w-md py-20">
      <div className="card-surface p-8">
        <span className="icon-tile">
          <LockKeyhole className="size-5" />
        </span>
        <p className="label-caps mt-5">Private · staff only</p>
        <h1 className="mt-2 text-4xl">Coach login</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Sign in to manage leads, notes, and outreach in your private
          workspace.
        </p>

        <div className="mt-8">
          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>
    </PageContainer>
  );
}
