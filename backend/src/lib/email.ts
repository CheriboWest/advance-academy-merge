/**
 * Transactional email via Resend (CA-001, Bước 5).
 *
 * Plain REST over fetch — no SDK dependency. Best-effort by design: this never
 * throws, so a provider hiccup can't fail the request that triggered the send
 * (e.g. lead capture). Callers inspect the returned `ok` flag if they care.
 *
 * Env:
 *   EMAIL_API_KEY  — Resend API key (unset => sending disabled).
 *   EMAIL_FROM     — sender, e.g. "Advance Academy <noreply@yourdomain.com>".
 *                    Defaults to Resend's shared test sender, which only delivers
 *                    to the address that owns the Resend account.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Advance Academy <onboarding@resend.dev>';
const SEND_TIMEOUT_MS = 10_000;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export function isEmailSendingEnabled(): boolean {
  return Boolean(process.env.EMAIL_API_KEY?.trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'EMAIL_API_KEY not set' };

  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
