export interface ExtractedJob {
  jobTitle: string;
  jobDescription: string;
  companyName: string;
  companyUrl: string;
  extraLinks: string[];
}

// ── Interview-prep core types (mirrors features/interview-prep/types.ts) ────

export type PersonaId = 'skeptic' | 'mentor' | 'executive' | 'technical' | 'culture';

export interface InterviewerPersona {
  id: PersonaId;
  name: string;
  title: string;
  description: string;
  style: string;
  avatar: string;
  systemPrompt: string;
}

export interface InterviewContext {
  cvText: string;
  jobTitle: string;
  jobDescription: string;
  companyName: string;
  companyUrl: string;
  extraLinks: string[];
  /**
   * Optional questions the interviewer should draw from first (sprint F6b).
   *
   * Lives on the context rather than on StartSessionBody so it travels with
   * every turn and is persisted in `context_json` — the per-turn system prompt
   * is rebuilt from this object, so a field that only existed at start time
   * would both be forgotten after turn 1 and change the cached prefix, costing
   * a prompt-cache miss on every subsequent turn.
   */
  questionBank?: string[];
  /**
   * The coaching session this mock was launched from (ticket T7).
   *
   * Deliberately NOT read by `buildContextPreamble` — it is a link, not prompt
   * material, and putting it in the preamble would change the cached prefix for
   * no benefit. It rides on the context purely so it survives every turn and
   * reaches the evaluation, which is where the mock gets tied back to the
   * session the coach will read it against.
   */
  coachingSessionId?: string;
}

export interface IRSScorePart {
  score: number;
  rationale: string;
}

export interface IRSScore {
  integrity: IRSScorePart;
  relevance: IRSScorePart;
  substance: IRSScorePart;
  overall: number;
}

export interface InterviewMessage {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  timestamp: number;
  irsScore?: IRSScore;
}

export interface FeedbackItem {
  title: string;
  detail: string;
}

export interface FeedbackReport {
  sessionId: string;
  overallIRS: IRSScore;
  strengths: FeedbackItem[];
  improvements: FeedbackItem[];
  summary: string;
  generatedAt: number;
}

export interface InterviewSession {
  id: string;
  personaId: PersonaId;
  status: 'active' | 'evaluating' | 'complete';
  startedAt: number;
  endedAt?: number;
  messages: InterviewMessage[];
  context: InterviewContext;
  finalReport?: FeedbackReport;
}

export interface StartSessionBody {
  action: 'start';
  personaId: PersonaId;
  context: InterviewContext;
}

export interface SendMessageBody {
  action: 'message';
  sessionId: string;
  content: string;
  messageHistory: Array<{ role: 'interviewer' | 'candidate'; content: string }>;
  personaId: PersonaId;
  context: InterviewContext;
  dbSessionId?: string;
  questionId?: string;
}

export interface StartSessionResponse {
  sessionId: string;
  openingQuestion: string;
  dbSessionId?: string;
  questionId?: string;
}

export interface SendMessageResponse {
  reply: string;
  irsScore: IRSScore;
  isComplete: boolean;
  assessmentId?: string;
  nextQuestionId?: string;
}

export interface EvaluateSessionBody {
  session: InterviewSession;
  dbSessionId?: string;
}
