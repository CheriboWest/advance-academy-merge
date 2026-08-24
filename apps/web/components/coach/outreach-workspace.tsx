"use client";

import * as React from "react";

import type { Contact } from "@/lib/types";
import type { OutreachInput } from "@/lib/outreach";
import { ContactsSection } from "@/components/coach/contacts-section";
import { OutreachComposer } from "@/components/coach/outreach-composer";

interface OutreachWorkspaceProps {
  companyId: string;
  input: OutreachInput;
  initialSubject: string;
  initialBody: string;
  hasExistingDraft: boolean;
  initialContacts: Contact[];
}

/**
 * Owns the one piece of state `ContactsSection` and `OutreachComposer` both
 * need: the company's contact list. Adding, editing or deleting a contact in
 * `ContactsSection` is reflected immediately in the composer's recipient
 * picker, with no page reload — a plain server-rendered pair of siblings
 * couldn't do that, since neither Server Component can hold client state.
 */
export function OutreachWorkspace({
  companyId,
  input,
  initialSubject,
  initialBody,
  hasExistingDraft,
  initialContacts,
}: OutreachWorkspaceProps) {
  const [contacts, setContacts] = React.useState(initialContacts);

  return (
    <>
      <ContactsSection
        companyId={companyId}
        contacts={contacts}
        onContactsChange={setContacts}
      />

      <OutreachComposer
        companyId={companyId}
        input={input}
        initialSubject={initialSubject}
        initialBody={initialBody}
        hasExistingDraft={hasExistingDraft}
        contacts={contacts}
      />
    </>
  );
}
