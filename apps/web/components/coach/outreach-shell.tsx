"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleDot,
  Mail,
  SearchCheck,
  Send,
  Sparkles,
  TimerReset,
  UserRound,
} from "lucide-react";

import type { Contact, SponsoredCompanyRow } from "@/lib/types";
import { listContactsViaApi } from "@/lib/contacts-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface OutreachShellProps {
  companies: SponsoredCompanyRow[];
}

const NO_SELECTION = "";

interface FutureStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const FUTURE_STEPS: FutureStep[] = [
  {
    icon: SearchCheck,
    title: "Company & contact research",
    description:
      "Pull in recent hiring activity, news, and sponsorship context to brief the message.",
  },
  {
    icon: Sparkles,
    title: "Highly personalised generation",
    description:
      "Draft a message tailored to this contact and company, not a generic template.",
  },
  {
    icon: Send,
    title: "Sending",
    description: "Send the finished message directly to the chosen contact.",
  },
  {
    icon: TimerReset,
    title: "Tracking & follow-ups",
    description: "See what's been sent, what's outstanding, and when to follow up.",
  },
];

/**
 * Placeholder workflow shell for the future Outreach experience: choose a
 * company, choose a contact, and see what's coming next. Deliberately does
 * NOT reuse the old email-composer/generation/send flow — that
 * functionality still exists server-side (POST /ai/outreach, POST
 * /email/send) but this page intentionally doesn't wire it in yet, so this
 * reads as an honest work-in-progress rather than a half-finished tool.
 *
 * Reuses the same company/contact data as Sponsored Companies (companies via
 * getSponsoredCompanies passed in from the server, contacts via the same
 * GET /contacts the Contacts section on that page uses) — nothing here is a
 * separate copy of that data.
 */
export function OutreachShell({ companies }: OutreachShellProps) {
  const [companyId, setCompanyId] = React.useState<string>(NO_SELECTION);
  const [contacts, setContacts] = React.useState<Contact[] | null>(null);
  const [loadingContacts, setLoadingContacts] = React.useState(false);
  const [contactsError, setContactsError] = React.useState<string | null>(null);
  const [contactId, setContactId] = React.useState<string>(NO_SELECTION);

  const selectedCompany =
    companies.find((company) => company.company_id === companyId) ?? null;
  const selectedContact =
    contacts?.find((contact) => contact.id === contactId) ?? null;

  function handleSelectCompany(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    setContactId(NO_SELECTION);
    setContacts(null);
    setContactsError(null);

    if (!nextCompanyId) return;

    setLoadingContacts(true);
    void (async () => {
      try {
        setContacts(await listContactsViaApi(nextCompanyId));
      } catch (err) {
        setContactsError(
          err instanceof Error ? err.message : "Failed to load contacts."
        );
      } finally {
        setLoadingContacts(false);
      }
    })();
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-sm border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="outreach-company" className="text-sm font-medium">
              1. Choose a company
            </label>
            <Select value={companyId} onValueChange={handleSelectCompany}>
              <SelectTrigger id="outreach-company" className="h-11">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.company_id} value={company.company_id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="outreach-contact" className="text-sm font-medium">
              2. Choose a contact
            </label>
            <Select
              value={contactId}
              onValueChange={setContactId}
              disabled={!companyId || loadingContacts || !contacts?.length}
            >
              <SelectTrigger id="outreach-contact" className="h-11">
                <SelectValue
                  placeholder={
                    !companyId
                      ? "Choose a company first"
                      : loadingContacts
                        ? "Loading contacts…"
                        : contacts?.length
                          ? "Select a contact"
                          : "No contacts for this company yet"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {contacts?.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.full_name}
                    {contact.job_title ? ` — ${contact.job_title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {contactsError && (
          <p role="alert" className="text-sm text-destructive">
            {contactsError}
          </p>
        )}

        {companyId && !loadingContacts && contacts?.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="size-4 shrink-0" />
            {selectedCompany?.name} has no contacts yet.{" "}
            <Link
              href={`/coach/sponsored-companies/${companyId}`}
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              Add one on its company profile
              <ArrowUpRight className="size-3.5" />
            </Link>
          </p>
        )}

        {selectedCompany && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm">
            <span className="text-muted-foreground">Selected:</span>
            <Badge variant="secondary">{selectedCompany.name}</Badge>
            {selectedContact && (
              <>
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary">
                  {selectedContact.full_name}
                  {selectedContact.email ? "" : " (no email on file)"}
                </Badge>
              </>
            )}
            <Link
              href={`/coach/sponsored-companies/${selectedCompany.company_id}`}
              className="ml-auto inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              View company profile
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-sm border border-dashed border-border bg-card/50 p-6">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" />
          <h3 className="text-lg">Coming next</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {selectedContact
            ? `Research, personalised generation, sending, and tracking for ${selectedContact.full_name} at ${selectedCompany?.name} will live here.`
            : "Once a company and contact are chosen, this is where research, personalised generation, sending, and tracking will happen."}
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {FUTURE_STEPS.map((step) => (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-sm border border-border bg-card p-4"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <step.icon className="size-4" />
              </span>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  {step.title}
                  <CircleDot className="size-2.5 text-muted-foreground" />
                  <span className="text-xs font-normal text-muted-foreground">
                    not yet available
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
