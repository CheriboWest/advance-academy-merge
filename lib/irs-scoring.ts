import Anthropic from '@anthropic-ai/sdk'
import type { IRSScore, InterviewContext } from './types'

const client = new Anthropic()

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
}`

export async function scoreAnswer(
  question: string,
  answer: string,
  context?: InterviewContext
): Promise<IRSScore> {
  let userPrompt = `INTERVIEW QUESTION: ${question}\n\nCANDIDATE ANSWER: ${answer}`

  if (context) {
    userPrompt = `JOB TITLE: ${context.jobTitle}\nCOMPANY: ${context.companyName}\nJOB DESCRIPTION: ${context.jobDescription}\n\nCANDIDATE CV SUMMARY: ${context.cvText.substring(0, 1500)}\n\n${userPrompt}`
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: IRS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from IRS scorer')
  }

  const raw = textBlock.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(raw)

  return {
    integrity: {
      score: Math.min(10, Math.max(0, parsed.integrity.score)),
      rationale: parsed.integrity.rationale,
    },
    relevance: {
      score: Math.min(10, Math.max(0, parsed.relevance.score)),
      rationale: parsed.relevance.rationale,
    },
    substance: {
      score: Math.min(10, Math.max(0, parsed.substance.score)),
      rationale: parsed.substance.rationale,
    },
    overall: Math.min(
      10,
      Math.max(
        0,
        parsed.overall ??
          Math.round(
            (parsed.integrity.score * 0.3 +
              parsed.relevance.score * 0.3 +
              parsed.substance.score * 0.4) *
              10
          ) / 10
      )
    ),
  }
}

export function aggregateIRS(scores: IRSScore[]): IRSScore {
  if (scores.length === 0) {
    return {
      integrity: { score: 0, rationale: 'No answers to evaluate.' },
      relevance: { score: 0, rationale: 'No answers to evaluate.' },
      substance: { score: 0, rationale: 'No answers to evaluate.' },
      overall: 0,
    }
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  const integrity = avg(scores.map((s) => s.integrity.score))
  const relevance = avg(scores.map((s) => s.relevance.score))
  const substance = avg(scores.map((s) => s.substance.score))
  const overall = integrity * 0.3 + relevance * 0.3 + substance * 0.4

  return {
    integrity: {
      score: Math.round(integrity * 10) / 10,
      rationale: `Average across ${scores.length} answers.`,
    },
    relevance: {
      score: Math.round(relevance * 10) / 10,
      rationale: `Average across ${scores.length} answers.`,
    },
    substance: {
      score: Math.round(substance * 10) / 10,
      rationale: `Average across ${scores.length} answers.`,
    },
    overall: Math.round(overall * 10) / 10,
  }
}
