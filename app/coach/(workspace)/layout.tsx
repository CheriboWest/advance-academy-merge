import { redirect } from "next/navigation";

import { getCoachUser, isCoach } from "@/features/career-hub/lib/coach";
import { CoachSidebar } from "@/features/career-hub/components/coach/coach-sidebar";
import { CoachHeader } from "@/features/career-hub/components/coach/coach-header";

// Coach data depends on the authenticated session cookie.
export const dynamic = "force-dynamic";

export default async function CoachWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session check (defence in depth alongside middleware). Still a
  // real signature verification — see getCoachUser — just not a second network
  // round trip on top of the one middleware already made.
  const claims = await getCoachUser();
  if (!claims) {
    redirect("/coach/login");
  }

  // Authenticated is not the same as staff. Since the merge this Supabase
  // project also holds every student account, so a valid session proves only
  // that someone signed up. Send them to the app they do have access to rather
  // than an empty coach shell.
  if (!(await isCoach())) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <CoachSidebar />
      <div className="min-w-0 flex-1 space-y-8 py-8 md:pl-8">
        <CoachHeader email={claims.email ?? "Coach"} />
        {children}
      </div>
    </div>
  );
}
