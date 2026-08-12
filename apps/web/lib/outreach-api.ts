import type { GeneratedOutreach, OutreachInput } from "@/lib/outreach";

/**
 * Call the FastAPI backend to generate an outreach email with Claude.
 *
 * The backend holds the Anthropic API key; the browser only ever talks to this
 * backend (via NEXT_PUBLIC_API_URL). The key is never exposed to the frontend.
 */
export async function generateOutreachViaApi(
  input: OutreachInput,
  signal?: AbortSignal
): Promise<GeneratedOutreach> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_URL. Set it in apps/web/.env.local to your API URL."
    );
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ai/outreach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: input.name,
      location: input.location,
      sector: input.sector,
      open_jobs: input.openJobs,
      lead_score: input.leadScore,
    }),
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

  const data = (await response.json()) as {
    subject?: string;
    body?: string;
  };

  if (!data.subject || !data.body) {
    throw new Error("The AI service returned an unexpected response.");
  }

  return { subject: data.subject, body: data.body };
}
