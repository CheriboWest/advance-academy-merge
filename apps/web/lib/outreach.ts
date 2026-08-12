/**
 * Deterministic outreach template generator.
 *
 * This is a stand-in for a real LLM: given a company's public context it
 * produces a professional British-English subject and body. It is a pure
 * function with no side effects or network calls, so it can run on the client
 * (in the composer) or the server.
 */

export interface OutreachInput {
  name: string;
  location: string | null;
  sector: string | null;
  openJobs: number;
  leadScore: number;
}

export interface GeneratedOutreach {
  subject: string;
  body: string;
}

function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

/** Generate a deterministic outreach subject and body from company context. */
export function generateOutreach(input: OutreachInput): GeneratedOutreach {
  const name = input.name.trim();
  const openJobs = Number.isFinite(input.openJobs) ? input.openJobs : 0;
  const leadScore = Number.isFinite(input.leadScore) ? input.leadScore : 0;
  const sector = input.sector?.trim() || "your industry";
  const location = input.location?.trim() || "";
  const locationClause = location ? ` based in ${location}` : "";

  const subject =
    openJobs > 0
      ? `Supporting your ${openJobs} open ${pluralise(openJobs, "role")} at ${name}`
      : `Exploring future opportunities with ${name}`;

  const opening = `Dear ${name} team,`;

  const intro =
    "I hope this message finds you well. I'm writing from CareerHub UK, " +
    "where we help talented students begin their careers with leading UK employers.";

  const context =
    openJobs > 0
      ? `We've been following your work in the ${sector} sector${locationClause}, and noticed you currently have ${openJobs} open ${pluralise(
          openJobs,
          "role"
        )}. Several of our students would be a strong match for your team.`
      : `We've been following your work in the ${sector} sector${locationClause}. While we couldn't see any live vacancies today, we'd welcome the chance to connect ahead of your future hiring.`;

  const priority =
    leadScore >= 80
      ? "Given your strong hiring momentum, we'd be delighted to prioritise tailored introductions over the coming weeks."
      : leadScore >= 40
        ? "As your team continues to grow, we'd be glad to line up suitable candidates whenever the timing suits."
        : "Even if now isn't the right moment, we'd value staying in touch so we can support your hiring when it picks up.";

  const cta =
    "Would you be open to a brief conversation to explore how we might work together?";

  const signoff = "Kind regards,\nThe CareerHub UK team";

  const body = [opening, intro, context, priority, cta, signoff].join("\n\n");

  return { subject, body };
}
