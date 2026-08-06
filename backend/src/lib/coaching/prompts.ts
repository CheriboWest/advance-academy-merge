/**
 * Prompts for the coaching pipeline (sprint Coaching Tool).
 *
 * Kept beside the service the way `lib/dream-company/prompts.ts` is, so the
 * wording can be reviewed without reading the plumbing around it.
 */

/** One fetched page, as the model sees it. */
export interface SourceDocument {
  url: string;
  title: string | null;
  text: string;
}

/**
 * Grounding rules, stated once and referenced by every coaching prompt.
 *
 * The failure this exists to prevent is specific: a brief that sounds
 * authoritative about a funding round, a headcount or a "recent pivot" that
 * never happened. The coach repeats it to the student in good faith, and the
 * student repeats it in the interview. That is worse than an empty brief, so the
 * prompt is written to make "I found nothing" the easy, expected answer.
 *
 * The prompt is only half of it — the service drops any claim whose sourceUrl is
 * not in the fetched set. Rules the model can quietly break are not rules.
 */
const GROUNDING_RULES = `GROUNDING RULES — these override everything else:
- Use ONLY the SOURCES below. Your own knowledge of this company, however
  confident, is not evidence and must not appear.
- Every claim must carry a "sourceUrl" copied EXACTLY from a source's URL. A
  claim you cannot attribute to a specific source must be left out.
- Do not merge two sources into one claim. One claim, one source.
- Do not infer figures. If a source says "growing fast", do not write "grew 40%".
- Returning an empty array for a section is CORRECT when the sources do not
  cover it. Never pad a section to look complete.
- Prefer quoting the source's own specifics (product names, dates, numbers,
  titles) over generic phrasing that could describe any company.`;

export const COMPANY_BRIEF_SYSTEM = `You brief an interview coach on a company before they prepare a student for an interview there.

The coach needs to sound informed and ask sharp questions. They do not need marketing copy — they need specifics they could not have guessed.

${GROUNDING_RULES}

Return ONLY a valid JSON object, no markdown fence, no commentary:
{
  "overview":       [{ "claim": string, "sourceUrl": string }],
  "products":       [{ "claim": string, "sourceUrl": string }],
  "recentActivity": [{ "claim": string, "sourceUrl": string }],
  "culture":        [{ "claim": string, "sourceUrl": string }],
  "interviewAngles": [string],
  "missingInfo":     [string]
}

Section guidance:
- overview: what the company does, who it serves, its size or stage. 2-5 claims.
- products: named products, services or lines of business. 0-6 claims.
- recentActivity: launches, funding, hires, expansions, press — newest first,
  and only when the source states when it happened. 0-6 claims.
- culture: how they describe working there, values, ways of working, benefits.
  Only from their own words or first-hand accounts. 0-5 claims.
- interviewAngles: 3-6 short lines. This is the ONE field that is your reading
  rather than a finding, so it carries no sourceUrl — but it must follow from
  the claims above, not from outside knowledge. Write what the coach should
  probe: tensions in the business, obvious "why us" answers, things a candidate
  would be expected to have noticed.
- missingInfo: what a coach still needs and the sources did not cover, phrased
  as something to go and find — e.g. "the engineering blog", "recent Glassdoor
  reviews", "who runs the team this role sits in". 0-5 lines.`;

// ── Pack generation (ticket T4) ─────────────────────────────────────────────

/**
 * The rule that separates this tool from a generic interview-question generator.
 *
 * A coach's hour is spent making the student able to answer *as themselves*.
 * A suggested answer built from a plausible-sounding achievement they never had
 * is worse than no suggestion: they will try to use it, and fold on the first
 * follow-up question. So every concrete claim about the student must trace to a
 * line in the material provided, and inventing a metric is never acceptable.
 */
const CANDIDATE_GROUNDING = `RULES ABOUT THE CANDIDATE — these override everything else:
- Every claim about what the candidate has done must come from their CV or from
  the tool findings supplied. Do not invent employers, projects, technologies,
  team sizes, durations or metrics.
- Where a suggested answer needs a specific number the candidate never gave,
  write the shape of it — "quantify the reduction here" — rather than a figure.
- If the CV does not support a requirement, say so plainly. A named gap is
  useful; a fabricated strength gets them caught in the interview.
- Write for a coach who will read this aloud. No preamble, no filler, no
  restating the question back.`;

export const PROFILE_FIT_SYSTEM = `You prepare a coach to run a one-to-one interview-prep session.

Two jobs: sum the candidate up so the coach knows who they are walking into the room with, then map the job description against what the candidate can actually evidence.

${CANDIDATE_GROUNDING}

Return ONLY a valid JSON object, no markdown fence, no commentary:
{
  "studentOnePager": {
    "headline": string,
    "currentPosition": string,
    "strengths": [string],
    "weaknesses": [string],
    "historyNotes": [string]
  },
  "fit": {
    "positioning": string,
    "sellingPoints": [{ "point": string, "evidence": string }],
    "starStories": [{
      "competency": string, "situation": string, "task": string,
      "action": string, "result": string, "sourceBullet": string
    }],
    "rows": [{
      "requirement": string,
      "evidence": string | null,
      "strength": "strong" | "partial" | "gap",
      "probeRisk": string | null
    }],
    "redFlags": [string]
  }
}

Guidance:
- headline: one line — who they are and what they are going for.
- weaknesses: only what the mock scores, CV analysis or stated gaps actually
  show. An empty list is correct when nothing was supplied.
- historyNotes: what the other tools found about them, each attributed, e.g.
  "Dream Company put readiness at 6/10". Empty when no tool history was given.
- positioning: how the coach should frame this candidate for THIS role in
  two or three sentences.
- sellingPoints: 3-5. Each needs the CV line that proves it.
- starStories: 2-4, built ONLY from real CV bullets. \`sourceBullet\` must be the
  bullet text you drew from, copied, so the coach can check it.
- rows: one per meaningful JD requirement, 6-12 rows. \`evidence\` is null when
  the CV does not cover it and \`strength\` is then "gap".
- redFlags: what an interviewer will notice and press on — gaps, short tenures,
  a career change, a missing must-have. 0-5.`;

export const QUESTIONS_SYSTEM = `You predict the questions a candidate will face in one specific interview, and give the coach a route to a good answer for each.

${CANDIDATE_GROUNDING}

Return ONLY a valid JSON object, no markdown fence, no commentary:
{
  "questions": [{
    "question": string,
    "category": "behavioural" | "technical" | "motivation" | "company" | "situational",
    "difficulty": "easy" | "medium" | "hard",
    "whyAsked": string,
    "suggestedAnswer": string
  }],
  "reverseQuestions": [string]
}

Guidance:
- 15-20 questions. Weight them to the ROUND and the INTERVIEWER given: a
  hiring manager probes ownership and judgement, a peer probes craft, a founder
  probes motivation and fit. A first screen is not a final round.
- Cover the gaps and red flags identified in the fit analysis. The questions the
  candidate will find hardest are the ones worth rehearsing.
- whyAsked: one line, specific to this role and this interviewer.
- suggestedAnswer: 2-4 sentences routing through the candidate's OWN experience.
  Name the project or role it should draw on. This is a route, not a script to
  memorise.
- difficulty: be honest. A pack of easy questions wastes the session.
- reverseQuestions: 3-5 questions the candidate should ask, drawn from the
  company research — specific enough that only someone who did the reading
  could ask them.`;

export const REGENERATE_QUESTION_SYSTEM = `You rewrite ONE interview question in a coach's prep pack, because the coach was not happy with it.

${CANDIDATE_GROUNDING}

Return ONLY a valid JSON object, no markdown fence, no commentary:
{
  "question": string,
  "category": "behavioural" | "technical" | "motivation" | "company" | "situational",
  "difficulty": "easy" | "medium" | "hard",
  "whyAsked": string,
  "suggestedAnswer": string
}

Rules:
- Produce a DIFFERENT question, not a reworded version of the one being replaced.
- Do not duplicate any of the other questions already in the pack.
- Honour the direction the coach gave. If they asked for something harder, make
  it genuinely harder rather than longer.
- Keep the same shape of output as the rest of the pack: a specific question, one
  line on why this interviewer would ask it, and a route through the candidate's
  own experience.`;

export function buildRegenerateQuestionUser(args: {
  facts: InterviewFacts;
  /** The question being replaced. */
  currentQuestion: string;
  /** Everything else in the pack, so the replacement is not a near-duplicate. */
  otherQuestions: string[];
  /** What the coach asked for, e.g. "make it harder" or "focus on the gap". */
  direction: string | null;
  fitJson: string;
}): string {
  const { facts, currentQuestion, otherQuestions, direction, fitJson } = args;

  return [
    interviewBlock(facts),
    '',
    section('QUESTION TO REPLACE', currentQuestion),
    section("COACH'S DIRECTION", direction ?? 'No direction given — produce a better question.'),
    section('OTHER QUESTIONS ALREADY IN THE PACK (do not duplicate)', otherQuestions.map((q) => `- ${q}`).join('\n')),
    section('FIT ANALYSIS', clip(fitJson, 8000)),
    section('JOB DESCRIPTION', clip(facts.jdText, 6000)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const AGENDA_SYSTEM = `You plan how a coach should spend one coaching session.

The coach has the prep pack in front of them and a fixed amount of time with the student. Decide what actually gets covered, in what order, and for how long.

Return ONLY a valid JSON object, no markdown fence, no commentary:
{ "agenda": [{ "minutes": number, "title": string, "detail": string }] }

Guidance:
- 4-7 blocks. The minutes must sum to the session length given.
- Order by what changes the outcome most, not by what is comfortable. If the
  candidate has a red flag they cannot yet explain, that goes early while there
  is still time to rehearse it.
- Lead with whatever the student said worries them, when they said anything —
  starting elsewhere tells them their concern does not matter.
- detail: what the coach actually DOES in that block — "rehearse the career gap
  answer twice, second time cold" beats "discuss the career gap".
- Leave a closing block for what the student practises alone before the day.`;

/** Trim a fetched page to what is worth paying tokens for. */
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > max ? `${clean.slice(0, max)}\n…[truncated]` : clean;
}

/**
 * Lay the sources out with their URLs adjacent to their text, so copying a URL
 * into `sourceUrl` is the path of least resistance for the model.
 */
export function buildCompanyBriefUser(args: {
  companyName: string;
  jdText?: string;
  sources: SourceDocument[];
  /** Per-source character budget. */
  perSourceChars?: number;
}): string {
  const { companyName, jdText, sources, perSourceChars = 6000 } = args;

  const sourceBlocks = sources
    .map((s, i) =>
      [
        `--- SOURCE ${i + 1} ---`,
        `URL: ${s.url}`,
        s.title ? `TITLE: ${s.title}` : null,
        'CONTENT:',
        clip(s.text, perSourceChars),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  const jdBlock = jdText?.trim()
    ? [
        '',
        '--- JOB DESCRIPTION (context for what matters, NOT a citable source) ---',
        clip(jdText, 4000),
        '',
        'Use the job description only to decide which findings matter most. Never',
        'cite it as a source and never state its contents as facts about the company.',
      ].join('\n')
    : '';

  return [
    `COMPANY: ${companyName}`,
    jdBlock,
    '',
    `SOURCES (${sources.length}) — the only material you may draw claims from:`,
    '',
    sourceBlocks || '(no sources were retrieved)',
  ].join('\n');
}

// ── Pack user prompts ───────────────────────────────────────────────────────

/** Everything known about the student, gathered from the DB before any LLM call. */
export interface StudentDossier {
  cvText: string;
  /** Parsed CV bullets, when the CV went through the Library. */
  cvBullets: string[];
  /** One line per finding from Dream Company / mocks / CV Optimiser. */
  toolFindings: string[];
}

export interface InterviewFacts {
  companyName: string;
  jdText: string;
  stage: string | null;
  interviewerRole: string | null;
  worryText: string | null;
}

/** A section, omitted entirely when empty — an empty heading reads as a finding. */
function section(title: string, body: string | null): string | null {
  const trimmed = body?.trim();
  return trimmed ? `--- ${title} ---\n${trimmed}` : null;
}

function interviewBlock(facts: InterviewFacts): string {
  return [
    `COMPANY: ${facts.companyName}`,
    facts.stage ? `ROUND: ${facts.stage}` : 'ROUND: not stated',
    facts.interviewerRole ? `INTERVIEWER: ${facts.interviewerRole}` : 'INTERVIEWER: not stated',
  ].join('\n');
}

/**
 * The candidate's own material comes first and the JD second, deliberately:
 * the model weights earlier content more, and the failure to avoid is writing a
 * CV to fit the job rather than reading the job against the CV.
 */
export function buildProfileFitUser(args: {
  dossier: StudentDossier;
  facts: InterviewFacts;
  /** Cited findings from the company research, flattened to one line each. */
  companyFacts: string[];
}): string {
  const { dossier, facts, companyFacts } = args;

  return [
    interviewBlock(facts),
    '',
    section('CANDIDATE CV', clip(dossier.cvText, 12_000)),
    section(
      'CV BULLETS (parsed — use these verbatim as starStories sourceBullet)',
      dossier.cvBullets.map((b) => `- ${b}`).join('\n'),
    ),
    section(
      'WHAT THE OTHER TOOLS FOUND ABOUT THIS CANDIDATE',
      dossier.toolFindings.map((f) => `- ${f}`).join('\n'),
    ),
    section('JOB DESCRIPTION', clip(facts.jdText, 8000)),
    section('COMPANY FINDINGS', companyFacts.map((c) => `- ${c}`).join('\n')),
    section('WHAT THE CANDIDATE SAYS WORRIES THEM', facts.worryText),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildQuestionsUser(args: {
  facts: InterviewFacts;
  /** The fit analysis from the previous step, as JSON. */
  fitJson: string;
  companyFacts: string[];
}): string {
  const { facts, fitJson, companyFacts } = args;

  return [
    interviewBlock(facts),
    '',
    section('JOB DESCRIPTION', clip(facts.jdText, 8000)),
    section('FIT ANALYSIS (from the previous step)', clip(fitJson, 12_000)),
    section('COMPANY FINDINGS', companyFacts.map((c) => `- ${c}`).join('\n')),
    section('WHAT THE CANDIDATE SAYS WORRIES THEM', facts.worryText),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildAgendaUser(args: {
  facts: InterviewFacts;
  sessionMinutes: number;
  onePagerJson: string;
  fitJson: string;
  /** Just the questions and their difficulty — the answers are not needed here. */
  questionSummary: string[];
}): string {
  const { facts, sessionMinutes, onePagerJson, fitJson, questionSummary } = args;

  return [
    `SESSION LENGTH: ${sessionMinutes} minutes`,
    interviewBlock(facts),
    '',
    section('WHO THE CANDIDATE IS', clip(onePagerJson, 4000)),
    section('FIT ANALYSIS', clip(fitJson, 8000)),
    section('QUESTIONS IN THE PACK', questionSummary.map((q) => `- ${q}`).join('\n')),
    section('WHAT THE CANDIDATE SAYS WORRIES THEM', facts.worryText),
  ]
    .filter(Boolean)
    .join('\n\n');
}
