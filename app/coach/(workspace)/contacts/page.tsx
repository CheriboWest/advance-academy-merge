import type { Metadata } from "next";

import { getContactDirectory } from "@/features/career-hub/lib/contacts";
import { ContactDirectory } from "@/features/career-hub/components/coach/contact-directory";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage() {
  const contacts = await getContactDirectory();

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Every HR, recruiter, hiring-manager and decision-maker contact across
          your companies. Add or edit contacts on each company&apos;s profile.
        </p>
      </header>
      <ContactDirectory contacts={contacts} />
    </div>
  );
}
