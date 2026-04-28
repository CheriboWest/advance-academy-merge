import type { DetectedField } from '../../types/cv-knowledge.js';

export function buildBulletExtractionPrompt(rawCv: string): string {
  return `You are extracting bullet points from a CV/resume.

Return ONLY valid JSON (no prose, no code fences) with this exact shape:
{
  "detected_field": "tech" | "business" | "marketing" | null,
  "bullets": [
    { "section_path": "Experience > Acme Corp > Backend Engineer", "bullet_text": "..." }
  ]
}

Rules:
- Extract every achievement/responsibility line. Skip headers, contact info, plain skill lists.
- "section_path" preserves hierarchy with " > " separators (Experience/Education/Projects > Org > Role).
- "bullet_text" is the verbatim line. Do NOT rewrite, summarize, or invent.
- Order matches the CV top-to-bottom.
- "detected_field" is your best single guess at the candidate's primary domain.

CV:
"""
${rawCv}
"""`;
}

export function buildGapPrompt(
  bulletText: string,
  sectionPath: string | null,
  detectedField: DetectedField,
): string {
  const fieldHint =
    detectedField === 'tech'
      ? 'Focus on: tech stack, scale/throughput numbers, the candidate\'s specific contribution, design decisions, measurable outcomes.'
      : detectedField === 'business'
        ? 'Focus on: scope (deal size / headcount / budget), the candidate\'s specific role, decision criteria, quantified business outcome, constraints.'
        : detectedField === 'marketing'
          ? 'Focus on: channel + spend, audience, creative/strategy choices, baseline vs result metrics, lessons learned.'
          : 'Focus on the most interview-relevant missing facts.';

  return `You are a tough interviewer reviewing a single CV bullet. List the FIVE most important factual details an interviewer would press the candidate to elaborate on. ${fieldHint}

Return ONLY valid JSON:
{
  "gaps": [
    { "question": "...", "rationale": "..." }
  ]
}

Rules:
- Exactly 5 items, ordered by importance (most important first).
- "question" is what you would literally ask the candidate. Short, concrete, factual (not philosophical).
- "rationale" is a one-sentence explanation of why this matters for an interview.
- Do NOT invent answers. Only ask.

Section: ${sectionPath ?? '(unknown)'}
Bullet: "${bulletText}"`;
}

export function buildArtifactSummaryPrompt(rawArtifactText: string, gapQuestion: string): string {
  return `You are summarizing a piece of evidence a job candidate provided to back up an interview claim.

Return ONLY valid JSON:
{
  "overview": "1-2 sentence factual overview",
  "my_contribution": "What the CANDIDATE specifically did (verbatim quotes preferred). Empty string if not stated.",
  "concrete_facts": ["..."],
  "metrics": ["..."]
}

Rules:
- Use ONLY information present in the source. Do not infer or generalize.
- "concrete_facts" = nouns/verbs/decisions present in the source (tech names, dates, scopes, named systems).
- "metrics" = numeric facts (counts, %, $, durations, sizes).
- Stay tight: 5-10 entries max in each list.
- Bias the extraction toward answering this gap question: "${gapQuestion}"

Source:
"""
${rawArtifactText.slice(0, 15000)}
"""`;
}

export interface CoachEvidenceBlock {
  bulletId: string;
  bulletText: string;
  section: string | null;
  artifacts: Array<{
    overview: string;
    my_contribution: string;
    concrete_facts: string[];
    metrics: string[];
  }>;
}

export interface CoachConversationTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

export interface CoachIrsRationale {
  integrity?: string | null;
  relevance?: string | null;
  substance?: string | null;
}

export function buildCoachAnswerPrompt(args: {
  question: string;
  answer: string;
  jobTitle: string;
  jobDescription: string;
  companyName: string;
  conversationHistory: CoachConversationTurn[];
  irsScore?: { integrity: number; relevance: number; substance: number; overall: number };
  irsRationale?: CoachIrsRationale;
  evidence: CoachEvidenceBlock[];
}): { system: string; user: string } {
  const system = `You are an interview coach producing an enhanced version of a candidate's answer.

CRITICAL RULES — read carefully:
1. You may ONLY use facts from: (a) the candidate's own answer, (b) the EVIDENCE POOL (the bullets the user picked + their attached artifact summaries).
2. NEVER invent metrics, dates, team sizes, tech stacks, client names, percentages, or outcomes.
3. If a fact is missing that would strengthen the answer, write a placeholder of the form
   [CANDIDATE TO FILL: <bulletId>|<short specific question>]
   Use bulletId from the EVIDENCE POOL when the placeholder relates to a specific bullet.
   Use "none" as the bulletId if the placeholder isn't tied to one bullet.
4. Use STAR structure (Situation, Task, Action, Result) where it fits.
5. Match the candidate's voice. First person.
6. Use the IRS FEEDBACK below to prioritise improvements: if Substance scored low, lean harder on metrics from the evidence; if Relevance scored low, tie the answer back to the interview question and the JD; if Integrity scored low, stay closer to what the candidate actually said.
7. Use the CONVERSATION HISTORY for coherence — don't reuse phrasing the candidate already used in earlier turns and don't contradict facts they already stated.

Return ONLY valid JSON:
{
  "critique": "1-2 sentences on what made the original answer weak",
  "improvedAnswer": "the rewritten answer, with [CANDIDATE TO FILL: ...] placeholders where evidence is missing",
  "missingEvidencePrompts": [
    { "bulletId": "<id or null>", "question": "the same question used in the placeholder above" }
  ]
}`;

  const evidenceBlock =
    args.evidence.length === 0
      ? '(no attached evidence — the user did not select any CV bullets; rely on the candidate answer alone and surface placeholders for missing facts)'
      : args.evidence
          .map(
            (e) =>
              `--- Bullet [${e.bulletId}] (${e.section ?? 'n/a'}): "${e.bulletText}"\n` +
              (e.artifacts.length === 0
                ? '  (no attached artifacts for this bullet)'
                : e.artifacts
                    .map(
                      (a, i) =>
                        `  Artifact ${i + 1}:\n` +
                        `    overview: ${a.overview}\n` +
                        `    my_contribution: ${a.my_contribution}\n` +
                        `    concrete_facts: ${a.concrete_facts.join('; ')}\n` +
                        `    metrics: ${a.metrics.join('; ')}`,
                    )
                    .join('\n')),
          )
          .join('\n\n');

  const historyBlock = args.conversationHistory.length
    ? args.conversationHistory
        .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.content}`)
        .join('\n')
    : '(no prior turns in this session)';

  const irsBlock = args.irsScore
    ? [
        `Integrity ${args.irsScore.integrity}/10${args.irsRationale?.integrity ? ` — ${args.irsRationale.integrity}` : ''}`,
        `Relevance ${args.irsScore.relevance}/10${args.irsRationale?.relevance ? ` — ${args.irsRationale.relevance}` : ''}`,
        `Substance ${args.irsScore.substance}/10${args.irsRationale?.substance ? ` — ${args.irsRationale.substance}` : ''}`,
        `Overall ${args.irsScore.overall}/10`,
      ].join('\n')
    : '(no IRS scoring available for this answer)';

  const user = `JOB TITLE: ${args.jobTitle}
COMPANY: ${args.companyName}
JOB DESCRIPTION: ${args.jobDescription}

CONVERSATION HISTORY (most recent last):
${historyBlock}

IRS FEEDBACK ON THE CANDIDATE'S ORIGINAL ANSWER:
${irsBlock}

EVIDENCE POOL (only the bullets the user picked, with their artifact summaries):
${evidenceBlock}

INTERVIEW QUESTION: ${args.question}

CANDIDATE'S ORIGINAL ANSWER:
${args.answer}

Rewrite the candidate's answer following the rules above.`;

  return { system, user };
}
