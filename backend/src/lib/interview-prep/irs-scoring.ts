import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../llm-anthropic.js';
import type { IRSScore, InterviewContext } from '../../types/interview-prep.js';

const IRS_SYSTEM_PROMPT = `You are an expert interview coach and evaluator. Your task is to score
a candidate's interview answer using the IRS rubric:

INTEGRITY (0–10): Does the answer feel authentic and honest? Is it internally consistent?
Does it avoid exaggeration or contradiction with prior statements? High scores = candid, genuine.

RELEVANCE (0–10): Does the answer directly address the question? Does it stay on topic?
Does it align with the competency being tested and the target job role?
Tangential answers, non-answers, or topic drift = lower scores.

SUBSTANCE (0–10): Does the answer have real depth? Concrete examples? Specific metrics?
STAR method (Situation, Task, Action, Result)? Generic platitudes = 0–3. Rich specifics = 8–10.

Overall score = (Integrity × 0.30) + (Relevance × 0.30) + (Substance × 0.40)

IMPORTANT: Score the answer against the question, the competency under test, the job description,
the company/role expectations, and the candidate's profile from the CV when provided.

Respond ONLY with valid JSON matching this exact schema:
{
  "integrity": { "score": <0-10>, "rationale": "<one sentence>" },
  "relevance": { "score": <0-10>, "rationale": "<one sentence>" },
  "substance": { "score": <0-10>, "rationale": "<one sentence>" },
  "overall": <weighted average, one decimal>
}`;

function clamp(n: number): number {
  return Math.min(10, Math.max(0, n));
}

export async function scoreAnswer(
  question: string,
  answer: string,
  context?: InterviewContext,
): Promise<IRSScore> {
  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
  const model = getFeatureModel('interviewPrep');

  let userPrompt = `INTERVIEW QUESTION: ${question}\n\nCANDIDATE ANSWER: ${answer}`;
  if (context) {
    const cvText = context.cvText.slice(0, 8000);
    userPrompt =
      `=== JOB BEING INTERVIEWED FOR ===\n` +
      `Title: ${context.jobTitle}\n` +
      `Company: ${context.companyName}\n` +
      `Job Description (the role's requirements — NOT things the candidate claimed):\n"""\n${context.jobDescription}\n"""\n\n` +
      `=== CANDIDATE'S CV (the ONLY source of claims the candidate has made) ===\n"""\n${cvText}\n"""\n\n` +
      `When judging Integrity, compare the answer ONLY against the CV section above. Do not treat Job Description text as claims the candidate made.\n\n` +
      userPrompt;
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 512,
    system: IRS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('No text response from IRS scorer');
  }

  const raw = block.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(raw);

  return {
    integrity: { score: clamp(parsed.integrity.score), rationale: parsed.integrity.rationale },
    relevance: { score: clamp(parsed.relevance.score), rationale: parsed.relevance.rationale },
    substance: { score: clamp(parsed.substance.score), rationale: parsed.substance.rationale },
    overall: clamp(
      parsed.overall ??
        Math.round(
          (parsed.integrity.score * 0.3 + parsed.relevance.score * 0.3 + parsed.substance.score * 0.4) * 10,
        ) / 10,
    ),
  };
}

export function aggregateIRS(scores: IRSScore[]): IRSScore {
  if (scores.length === 0) {
    return {
      integrity: { score: 0, rationale: 'No answers to evaluate.' },
      relevance: { score: 0, rationale: 'No answers to evaluate.' },
      substance: { score: 0, rationale: 'No answers to evaluate.' },
      overall: 0,
    };
  }
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const integrity = avg(scores.map((s) => s.integrity.score));
  const relevance = avg(scores.map((s) => s.relevance.score));
  const substance = avg(scores.map((s) => s.substance.score));
  const overall = integrity * 0.3 + relevance * 0.3 + substance * 0.4;
  const label = `Average across ${scores.length} answers.`;
  return {
    integrity: { score: Math.round(integrity * 10) / 10, rationale: label },
    relevance: { score: Math.round(relevance * 10) / 10, rationale: label },
    substance: { score: Math.round(substance * 10) / 10, rationale: label },
    overall: Math.round(overall * 10) / 10,
  };
}
