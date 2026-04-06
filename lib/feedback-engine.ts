import Anthropic from '@anthropic-ai/sdk'
import type { FeedbackReport, InterviewSession } from './types'
import { aggregateIRS } from './irs-scoring'

const client = new Anthropic()

const FEEDBACK_SYSTEM_PROMPT = `You are a world-class interview coach reviewing a completed mock interview.
Your job: analyze the full transcript and produce exactly 3 strengths and 3 areas for improvement.

STRENGTHS: The 3 best moments, patterns, or qualities demonstrated. Be specific and encouraging.
IMPROVEMENTS: The 3 most important things to fix. Be direct, actionable, and constructive.

For each item provide:
- title: A short (3-6 word) label
- detail: 1-2 sentences of specific, actionable feedback

Also write a brief overall summary (2-3 sentences) of the candidate's performance.

Respond ONLY with valid JSON matching this exact schema:
{
  "strengths": [
    { "title": "...", "detail": "..." },
    { "title": "...", "detail": "..." },
    { "title": "...", "detail": "..." }
  ],
  "improvements": [
    { "title": "...", "detail": "..." },
    { "title": "...", "detail": "..." },
    { "title": "...", "detail": "..." }
  ],
  "summary": "..."
}`

export async function generateFeedbackReport(
  session: InterviewSession
): Promise<FeedbackReport> {
  const transcript = session.messages
    .map((m) => {
      const role = m.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'
      const score = m.irsScore ? ` [IRS: ${m.irsScore.overall}/10]` : ''
      return `${role}${score}: ${m.content}`
    })
    .join('\n\n')

  const candidateScores = session.messages
    .filter((m) => m.role === 'candidate' && m.irsScore)
    .map((m) => m.irsScore!)

  const overallIRS = aggregateIRS(candidateScores)

  let userPrompt = `INTERVIEW TRANSCRIPT:\n\n${transcript}\n\nOVERALL IRS SCORES:\nIntegrity: ${overallIRS.integrity.score}/10\nRelevance: ${overallIRS.relevance.score}/10\nSubstance: ${overallIRS.substance.score}/10\nOverall: ${overallIRS.overall}/10`

  if (session.context) {
    userPrompt = `JOB TITLE: ${session.context.jobTitle}\nCOMPANY: ${session.context.companyName}\nJOB DESCRIPTION: ${session.context.jobDescription}\n\n${userPrompt}`
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: FEEDBACK_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from feedback engine')
  }

  const raw = textBlock.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(raw)

  return {
    sessionId: session.id,
    overallIRS,
    strengths: parsed.strengths as FeedbackReport['strengths'],
    improvements: parsed.improvements as FeedbackReport['improvements'],
    summary: parsed.summary,
    generatedAt: Date.now(),
  }
}
