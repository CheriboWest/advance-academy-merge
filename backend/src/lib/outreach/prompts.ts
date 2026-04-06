import type {
  DesiredRole,
  LinkedInProfileRaw,
  ProfileSignal,
  RecruiterData,
  RoleData,
  TargetData,
} from '../../types/outreach.js';

export const OUTREACH_PROFILE_FACT_SYSTEM =
  'You are a profile analyst. Extract structured facts from this LinkedIn profile. Respond with valid JSON only. No markdown. No explanation.';

export function buildProfileFactExtractionUserPrompt(rawProfile: LinkedInProfileRaw): string {
  return `Analyze this LinkedIn profile and return a JSON object with these exact fields:
- "currentTitle" (string): their current job title
- "background" (string): 1-2 sentence professional background summary
- "differentiators" (string[]): what makes them stand out
- "proofPoints" (string[]): measurable achievements or credentials
- "topSkills" (string[]): top 5-7 skills
- "industries" (string[]): industries they've worked in
- "yearsExperience" (number): estimated total years of professional experience
- "employmentStatus" (string): employed, unemployed, freelance, etc.
- "availability" (string): immediate, open to opportunities, not looking, etc.

Profile data:
${JSON.stringify(rawProfile, null, 2)}`;
}

export const OUTREACH_TONE_SYSTEM =
  'You are a writing tone analyst. Analyze the tone and writing style of this text. Respond with valid JSON only. No markdown. No explanation.';

export function buildToneAnalysisUserPrompt(writingSample: string): string {
  return `Analyze the tone and writing style of this text and return a JSON object with these exact fields:
- "tone" (one of: "direct", "warm", "analytical", "storytelling", "conversational")
- "vocabularyStyle" (one of: "formal", "casual", "technical", "hybrid")
- "preferredFraming" (one of: "data-driven", "narrative", "outcome-focused")

Text:
${writingSample}`;
}

export function buildLinkedInSystemPrompt(senderSignal: ProfileSignal): string {
  return `You are an expert LinkedIn outreach copywriter. Generate a LinkedIn connection message that follows these rules strictly:
- Maximum 300 characters
- Never start with "I" or "Hi my name is"
- Never use generic phrases: "I came across your profile", "I'd love to connect", "I'm passionate about"
- Lead with the recipient — their company, role, or recent activity
- Structure: one hook + one value statement + one soft CTA
- Tone: ${senderSignal.tone}
- Vocabulary style: ${senderSignal.vocabularyStyle}
- Return ONLY the message text. No explanation, no quotes, no labels.`;
}

export function buildLinkedInUserPrompt(
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): string {
  return `Write a LinkedIn connection message from this sender to this recipient.

SENDER:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Key differentiators: ${senderSignal.differentiators.join(', ')}
- Top skills: ${senderSignal.topSkills.join(', ')}

RECIPIENT:
- Name: ${targetData.name}
- Role: ${targetData.role}
- Company: ${targetData.company}
- Industry: ${targetData.industry}
${targetData.recentActivity ? `- Recent activity: ${targetData.recentActivity}` : ''}
- Why this company: ${targetData.whyThisCompany}
${targetData.companySignal ? `- Company signal: ${targetData.companySignal}` : ''}

TARGET ROLE:
- Title: ${roleData.title}
- Department: ${roleData.department}
- Key requirements: ${roleData.keyRequirements.join(', ')}
- Implied pain: ${roleData.impliedPain}`;
}

export const OUTREACH_LINKEDIN_COMPRESSION_SYSTEM =
  'You compress text to fit within character limits while preserving meaning. Return ONLY the compressed text. No explanation.';

export function buildLinkedInCompressionUserPrompt(message: string): string {
  return `Compress this LinkedIn message to under 300 characters while preserving its meaning and tone:\n\n${message}`;
}

export function buildEmailSystemPrompt(senderSignal: ProfileSignal): string {
  return `You are an expert cold email copywriter for job seekers. Generate a cold outreach email with this exact output structure:

SUBJECT LINES:
[Curiosity]: ...
[Specific]: ...
[Direct]: ...

EMAIL BODY:
...

Rules:
- Each subject line must be under 50 characters
- Email body must be 150-200 words
- Body structure: hook → bridge → proof point (include a number) → value statement → low-friction CTA → confident sign-off
- Never use buzzwords: synergy, passionate, leverage, dynamic, results-driven
- Never use "I am writing to express my interest"
- Tone: ${senderSignal.tone}
- Framing: ${senderSignal.preferredFraming}
- Return ONLY the structured output above. No extra explanation.`;
}

export function buildEmailUserPrompt(
  senderSignal: ProfileSignal,
  targetData: TargetData,
  roleData: RoleData,
): string {
  return `Write a cold outreach email from this sender to this recipient about this role.

SENDER:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Differentiators: ${senderSignal.differentiators.join(', ')}
- Proof points: ${senderSignal.proofPoints.join(', ')}
- Top skills: ${senderSignal.topSkills.join(', ')}

RECIPIENT:
- Name: ${targetData.name}
- Role: ${targetData.role}
- Company: ${targetData.company}
- Industry: ${targetData.industry}
${targetData.recentActivity ? `- Recent activity: ${targetData.recentActivity}` : ''}
- Why this company: ${targetData.whyThisCompany}
${targetData.companySignal ? `- Company signal: ${targetData.companySignal}` : ''}
${targetData.hiringManager ? `- Hiring manager: ${targetData.hiringManager} (${targetData.hiringManagerRole})` : ''}

TARGET ROLE:
- Title: ${roleData.title}
- Department: ${roleData.department}
- Key requirements: ${roleData.keyRequirements.join(', ')}
- Implied pain: ${roleData.impliedPain}`;
}

export const OUTREACH_EMAIL_JSON_RETRY_SYSTEM =
  'Convert the following email draft into strict JSON. Respond with valid JSON only. No markdown. No explanation.';

export function buildEmailJsonRetryUserPrompt(rawText: string): string {
  return `Convert this email content into a JSON object with this exact shape:
{
  "subjectLines": {
    "curiosity": "...",
    "specific": "...",
    "direct": "..."
  },
  "body": "..."
}

Content to convert:
${rawText}`;
}

export const OUTREACH_RECRUITER_PITCH_SYSTEM = `You are an expert recruiter outreach copywriter. Generate a pitch message to send to a recruiter. Rules:
- 80-100 words hard limit
- Structure: role target opener → 2-3 bullet fit snapshot → availability line → single CTA
- Use numbers over adjectives ("5 years" not "extensive experience")
- No storytelling, no "I came across your profile"
- Tone: direct, confident, efficient
- Return ONLY the pitch text. No explanation, no quotes, no labels.`;

export function buildRecruiterPitchUserPrompt(
  senderSignal: ProfileSignal,
  recruiterData: RecruiterData,
  desiredRole: DesiredRole,
): string {
  return `Write a recruiter pitch message from this candidate to this recruiter.

CANDIDATE:
- Name: ${senderSignal.name}
- Title: ${senderSignal.currentTitle}
- Background: ${senderSignal.background}
- Top skills: ${senderSignal.topSkills.join(', ')}
- Proof points: ${senderSignal.proofPoints.join(', ')}
- Years experience: ${senderSignal.yearsExperience}
- Availability: ${senderSignal.availability}

RECRUITER:
- Name: ${recruiterData.name}
- Type: ${recruiterData.type}
- Specialization: ${recruiterData.specialization}
${recruiterData.activeRoles ? `- Active roles: ${recruiterData.activeRoles.join(', ')}` : ''}

DESIRED ROLE:
- Title: ${desiredRole.title}
- Location: ${desiredRole.location}
${desiredRole.salaryExpectation ? `- Salary expectation: ${desiredRole.salaryExpectation}` : ''}`;
}

export const OUTREACH_RECRUITER_PITCH_COMPRESSION_SYSTEM =
  'You compress text to fit within word limits while keeping all key facts. Return ONLY the compressed text. No explanation.';

export function buildRecruiterPitchCompressionUserPrompt(pitch: string): string {
  return `Compress this recruiter pitch to under 100 words while keeping all key facts and numbers:\n\n${pitch}`;
}
