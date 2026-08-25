import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Contact, ContactInput } from "@/lib/types";

/**
 * Client-side contact mutations against the FastAPI backend — for reading
 * a company's contacts from a Server Component, see lib/contacts.ts. Split
 * the same way lib/sponsorship-api.ts (client writes) is split from
 * lib/sponsorship.ts (server reads): this file imports the *browser*
 * Supabase client, which cannot be pulled into a Server Component.
 */
async function authFetch<T>(path: string, init: RequestInit): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You must be signed in to manage contacts.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (data?.detail) detail = String(data.detail);
    } catch {
      // keep default
    }
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function createContactViaApi(
  companyId: string,
  input: ContactInput
): Promise<Contact> {
  return authFetch<Contact>("/contacts", {
    method: "POST",
    body: JSON.stringify({ company_id: companyId, ...input }),
  });
}

export function updateContactViaApi(
  contactId: string,
  input: ContactInput
): Promise<Contact> {
  return authFetch<Contact>(`/contacts/${contactId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteContactViaApi(contactId: string): Promise<void> {
  return authFetch<void>(`/contacts/${contactId}`, { method: "DELETE" });
}
