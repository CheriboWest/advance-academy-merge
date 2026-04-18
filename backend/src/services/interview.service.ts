import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { getPersona } from '../lib/interview-prep/personas.js';
import { scoreAnswer } from '../lib/interview-prep/irs-scoring.js';
import {
  dbStartSession,
  dbStoreQuestion,
  dbStoreAssessment,
  dbCompleteSession,
  dbUpdateSessionStatus,
} from '../lib/interview-prep/db.js';
import { generateFeedbackReport } from './feedback-engine.service.js';
import type {
  InterviewContext,
  StartSessionResponse,
  SendMessageResponse,
  StartSessionBody,
  SendMessageBody,
  EvaluateSessionBody,
  FeedbackReport,
} from '../types/interview-prep.js';

function buildContextPreamble(context: InterviewContext): string {
  const cvText = context.cvText.slice(0, 12000);
  return `
=== JOB BEING INTERVIEWED FOR ===
Title: ${context.jobTitle}
Company: ${context.companyName}${context.companyUrl ? ` (${context.companyUrl})` : ''}
Job Description (requirements, responsibilities — NOT claims the candidate made):
"""
${context.jobDescription}
"""

=== CANDIDATE'S CV (the ONLY source of claims the candidate has actually made) ===
"""
${cvText}
"""
${context.extraLinks ? `\nAdditional candidate links: ${context.extraLinks}\n` : ''}
=== RULES FOR YOUR QUESTIONS ===
1. Tailor questions to the job above, but base any reference to "what the candidate said/wrote/claims" ONLY on the CV section — never on the Job Description.
2. Do NOT paraphrase, quote, or attribute Job Description text to the candidate. The JD is the role's requirements, not the candidate's statements.
3. If the CV does not mention a specific skill, project, or metric that the JD asks for, you may ask the candidate to explain how they would meet that requirement — but phrase it as a gap to explore, not as a claim to challenge.
4. Only challenge or "dig into" claims that actually appear verbatim or clearly in the CV section.
5. Ask one question at a time.`;
}

export async function startInterviewSession(body: StartSessionBody): Promise<StartSessionResponse> {
  const persona = getPersona(body.personaId);
  if (!persona) {
    throw Object.assign(new Error('Invalid persona'), { statusCode: 400 });
  }

  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
  const model = getFeatureModel('interviewPrep');

  const contextPreamble = body.context ? buildContextPreamble(body.context) : '';
  const systemPrompt = persona.systemPrompt + (contextPreamble ? `\n\n${contextPreamble}` : '');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 256,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content:
          'Please begin the interview with your opening question. Just ask the first question — no preamble.',
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  const openingQuestion = block && block.type === 'text' ? block.text : 'Tell me about yourself.';

  const clientSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let dbSessionId: string | undefined;
  if (body.context) {
    const dbSession = await dbStartSession(body.personaId, body.context);
    if (dbSession) {
      dbSessionId = dbSession.id;
      await dbStoreQuestion(dbSessionId, openingQuestion);
    }
  }

  return { sessionId: clientSessionId, openingQuestion, dbSessionId };
}

export async function sendInterviewMessage(body: SendMessageBody): Promise<SendMessageResponse> {
  const persona = getPersona(body.personaId);
  if (!persona) {
    throw Object.assign(new Error('Invalid persona'), { statusCode: 400 });
  }

  const lastQuestion =
    body.messageHistory.filter((m) => m.role === 'interviewer').slice(-1)[0]?.content ?? '';

  const irsScore = await scoreAnswer(lastQuestion, body.content, body.context);

  if (body.dbSessionId) {
    const dbQuestion = await dbStoreQuestion(body.dbSessionId, lastQuestion);
    if (dbQuestion) {
      await dbStoreAssessment(body.dbSessionId, dbQuestion.id, body.content, irsScore);
    }
  }

  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
  const model = getFeatureModel('interviewPrep');

  const contextPreamble = body.context ? buildContextPreamble(body.context) : '';
  const systemPrompt = persona.systemPrompt + (contextPreamble ? `\n\n${contextPreamble}` : '');

  const claudeMessages = body.messageHistory.map((m) => ({
    role: m.role === 'interviewer' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }));
  claudeMessages.push({ role: 'user', content: body.content });

  const candidateTurnCount = body.messageHistory.filter((m) => m.role === 'candidate').length;
  const isLastTurn = candidateTurnCount >= 5;

  const systemAddendum = isLastTurn
    ? `\n\n[IMPORTANT: This is the final exchange. Ask one brief follow-up if needed, then thank the candidate and professionally conclude the interview. End with a clear closing statement.]`
    : '';

  const replyResponse = await anthropic.messages.create({
    model,
    max_tokens: 300,
    system: systemPrompt + systemAddendum,
    messages: claudeMessages,
  });

  const replyBlock = replyResponse.content.find((b) => b.type === 'text');
  const reply = replyBlock && replyBlock.type === 'text' ? replyBlock.text : 'Thank you for sharing that.';

  if (body.dbSessionId && !isLastTurn) {
    await dbStoreQuestion(body.dbSessionId, reply);
  }

  return { reply, irsScore, isComplete: isLastTurn };
}

export async function evaluateInterview(body: EvaluateSessionBody): Promise<{ report: FeedbackReport }> {
  if (!body.session || !body.session.messages || body.session.messages.length === 0) {
    throw Object.assign(new Error('Invalid session data'), { statusCode: 400 });
  }
  if (body.dbSessionId) {
    await dbUpdateSessionStatus(body.dbSessionId, 'evaluating');
  }
  const report = await generateFeedbackReport(body.session);
  if (body.dbSessionId) {
    await dbCompleteSession(body.dbSessionId, report.overallIRS, report);
  }
  return { report };
}
