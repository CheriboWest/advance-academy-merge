import { redirect } from "next/navigation";

import { getCoachUser } from "@/lib/coach";
import { CoachSidebar } from "@/components/coach/coach-sidebar";
import { CoachHeader } from "@/components/coach/coach-header";

// Coach data depends on the authenticated session cookie.
export const dynamic = "force-dynamic";

export default async function CoachWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session check (defence in depth alongside middleware).
  const user = await getCoachUser();
  if (!user) {
    redirect("/coach/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <CoachSidebar />
      <div className="min-w-0 flex-1 space-y-8 py-8 md:pl-8">
        <CoachHeader email={user.email ?? "Coach"} />
        {children}
      </div>
    </div>
  );
}
