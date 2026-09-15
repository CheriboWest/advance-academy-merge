import { getSupabaseBrowser } from "@/shared/auth/supabase-browser";

export interface SendEmailResult {
  status: string;
  sent_at: string;
  recipient_email: string;
}

/**
 * Send a saved outreach draft via the FastAPI backend (POST /email/send,
 * which relays through Resend). Sends the signed-in coach's Supabase access
 * token as a Bearer token; the Resend API key lives only on the backend.
 */
export async function sendEmailViaApi(
  draftId: string,
  to: string,
  signal?: AbortSignal
): Promise<SendEmailResult> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const supabase = getSupabaseBrowser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in to send email.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ draft_id: draftId, to }),
    signal,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (data?.detail) detail = String(data.detail);
    } catch {
      // Non-JSON error body — keep the default message.
    }
    throw new Error(detail);
  }

  return (await response.json()) as SendEmailResult;
}
