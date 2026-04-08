import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getPersona } from '@/data/personas'
import type {
  StartSessionRequest,
  StartSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  InterviewContext,
} from '@/features/interview-prep/types'
import { scoreAnswer } from '@/shared/utils/irs-scoring'
import { dbStartSession, dbStoreQuestion, dbStoreAssessment } from '@/shared/utils/db'

const client = new Anthropic()

function buildContextPreamble(context: InterviewContext): string {
  return `
CANDIDATE CONTEXT:
- Job Title: ${context.jobTitle}
- Company: ${context.companyName}${context.companyUrl ? ` (${context.companyUrl})` : ''}
- Job Description: ${context.jobDescription}
- Candidate CV Summary: ${context.cvText.substring(0, 2000)}
${context.extraLinks ? `- Additional Links: ${context.extraLinks}` : ''}

Use this context to tailor your questions to the specific role, company, and candidate background.
Focus on competencies relevant to this job description.`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Start session ────────────────────────────
    if (body.action === 'start') {
      const { personaId, context } = body as StartSessionRequest & { action: string }
      const persona = getPersona(personaId)
      if (!persona) {
        return NextResponse.json({ error: 'Invalid persona' }, { status: 400 })
      }

      const contextPreamble = context ? buildContextPreamble(context) : ''
      const systemPrompt = persona.systemPrompt + (contextPreamble ? `\n\n${contextPreamble}` : '')

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content:
              'Please begin the interview with your opening question. Just ask the first question — no preamble.',
          },
        ],
      })

      const textBlock = response.content.find((b) => b.type === 'text')
      const openingQuestion =
        textBlock && textBlock.type === 'text'
          ? textBlock.text
          : 'Tell me about yourself.'

      // Generate client-facing session ID
      const clientSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // Persist to database (non-blocking — don't fail the request if DB is down)
      let dbSessionId: string | null = null
      if (context) {
        const dbSession = await dbStartSession(personaId, context)
        if (dbSession) {
          dbSessionId = dbSession.id
          // Store the opening question
          await dbStoreQuestion(dbSessionId, openingQuestion)
        }
      }

      return NextResponse.json({
        sessionId: clientSessionId,
        openingQuestion,
        // Pass the DB session ID back so the client can include it in future requests
        dbSessionId: dbSessionId ?? undefined,
      } as StartSessionResponse & { dbSessionId?: string })
    }

    // ── Send candidate message ───────────────────
    if (body.action === 'message') {
      const { content, messageHistory, personaId, context } =
        body as SendMessageRequest & { action: string }
      const dbSessionId: string | undefined = body.dbSessionId

      const persona = getPersona(personaId)
      if (!persona) {
        return NextResponse.json({ error: 'Invalid persona' }, { status: 400 })
      }

      const lastQuestion =
        messageHistory.filter((m) => m.role === 'interviewer').slice(-1)[0]?.content ?? ''

      // Score the candidate's answer
      const irsScore = await scoreAnswer(lastQuestion, content, context)

      // Persist question + assessment to database
      if (dbSessionId) {
        // Store the question that was asked
        const dbQuestion = await dbStoreQuestion(dbSessionId, lastQuestion)
        if (dbQuestion) {
          // Store the scored assessment for this answer
          await dbStoreAssessment(dbSessionId, dbQuestion.id, content, irsScore)
        }
      }

      // Build conversation for Claude
      const contextPreamble = context ? buildContextPreamble(context) : ''
      const systemPrompt = persona.systemPrompt + (contextPreamble ? `\n\n${contextPreamble}` : '')

      const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
        messageHistory.map((m) => ({
          role: m.role === 'interviewer' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }))

      claudeMessages.push({ role: 'user', content })

      const candidateTurnCount = messageHistory.filter(
        (m) => m.role === 'candidate'
      ).length
      const isLastTurn = candidateTurnCount >= 5

      const systemAddendum = isLastTurn
        ? `\n\n[IMPORTANT: This is the final exchange. Ask one brief follow-up if needed, then thank the candidate and professionally conclude the interview. End with a clear closing statement.]`
        : ''

      const replyResponse = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt + systemAddendum,
        messages: claudeMessages,
      })

      const replyBlock = replyResponse.content.find((b) => b.type === 'text')
      const reply =
        replyBlock && replyBlock.type === 'text'
          ? replyBlock.text
          : 'Thank you for sharing that.'

      // Store the interviewer's follow-up question in DB too
      if (dbSessionId && !isLastTurn) {
        await dbStoreQuestion(dbSessionId, reply)
      }

      return NextResponse.json({
        reply,
        irsScore,
        isComplete: isLastTurn,
      } satisfies SendMessageResponse)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[/api/interview]', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
