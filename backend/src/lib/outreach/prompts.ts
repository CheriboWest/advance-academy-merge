import type { OutreachRequest } from '../../types/outreach.js';

export const OUTREACH_SYSTEM_PROMPT = `You are an expert career strategist and executive copywriter.
Your goal is to generate personalized, highly effective outreach messages for a job seeker.

You will receive the user's CV (and optional portfolio), Target Company, optional Target Person, Target Role, and up to two enrichment signals: a HIRING SIGNAL (job listings, hiring pages) and a SOCIAL SIGNAL (recent posts, news, interviews). You will also receive an OUTREACH INTENT.

Generate the messages requested in the OUTPUT FORMAT block.

CRITICAL RULES:
- Open with a specific, concrete detail from the HIRING SIGNAL or SOCIAL SIGNAL whenever it is available. Never use generic openers like "I came across your profile" or "I noticed your work".
- Lead with the recipient (their company, their role, their recent activity). Do not lead with the sender.
- Do not mention that you used job postings, search results, scraping, or any research tool. The signal is shown as if the sender naturally noticed it.
- Tailor the value proposition based on the user's CV (and portfolio, if any) AND the Target Role / Hiring Signal.
- Do not use buzzwords (synergy, passionate, leverage, results-driven).
- Email body MUST be at most 150 words. LinkedIn message MUST be at most 80 words and must not include a subject line.
- Format the output EXACTLY as valid JSON matching the OUTPUT FORMAT block. Do not include markdown formatting blocks.

INTENT GUIDELINES:
- direct_application: Hard pitch for a specific role. Match the sender's CV skills directly to the Hiring Signal requirements. End with a clear ask to be considered.
- referral_request: Soft ask to an employee. Lead with a shared interest or recent post (Social Signal). Ask for advice or a referral, not a job.
- informational_interview: Networking focus. Reference the Social Signal. Ask for 15 minutes to learn about their experience at the company.
- agency_recruiter: Pitch to a headhunter. Focus on metrics, top skills, availability, and the specific Target Role. Reference the Hiring Signal as proof of relevance.
`;

export function buildOutreachUserPrompt(
  request: OutreachRequest,
  hiringContext: string,
  socialContext: string,
): string {
  const sections: string[] = [];

  sections.push(`SENDER CV:\n${request.cvText.trim()}`);

  if (request.portfolioText && request.portfolioText.trim()) {
    sections.push(`SENDER PORTFOLIO / ADDITIONAL CONTEXT:\n${request.portfolioText.trim()}`);
  }

  const targetLines: string[] = [`- Company: ${request.targetCompany}`];
  if (request.targetPersonName && request.targetPersonName.trim()) {
    targetLines.push(`- Person: ${request.targetPersonName.trim()}`);
  }
  targetLines.push(`- Role: ${request.targetRole}`);
  targetLines.push(`- Experience Level: ${request.experienceLevel}`);
  sections.push(`TARGET:\n${targetLines.join('\n')}`);

  if (hiringContext.trim()) {
    sections.push(`HIRING SIGNAL (they are actively hiring for this role):\n${hiringContext.trim()}`);
  }

  if (socialContext.trim()) {
    sections.push(`RECENT ACTIVITY / SOCIAL SIGNAL:\n${socialContext.trim()}`);
  }

  sections.push(`OUTREACH INTENT: ${request.intent}`);

  const wantEmail = request.outputs.email;
  const wantLinkedIn = request.outputs.linkedIn;

  let formatBlock: string;
  if (wantEmail && wantLinkedIn) {
    formatBlock = `OUTPUT FORMAT — respond ONLY with this exact JSON object, no other text:
{
  "linkedInMessage": "string (≤ 80 words, no subject line)",
  "email": {
    "subject": "string",
    "body": "string (≤ 150 words)"
  }
}`;
  } else if (wantEmail) {
    formatBlock = `OUTPUT FORMAT — respond ONLY with this exact JSON object, no other text:
{
  "email": {
    "subject": "string",
    "body": "string (≤ 150 words)"
  }
}`;
  } else {
    formatBlock = `OUTPUT FORMAT — respond ONLY with this exact JSON object, no other text:
{
  "linkedInMessage": "string (≤ 80 words, no subject line)"
}`;
  }

  sections.push(formatBlock);

  return sections.join('\n\n');
}
