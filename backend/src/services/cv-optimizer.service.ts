/**
 * CV Optimizer — async job queue + structured CV analysis.
 * Uses Anthropic SDK directly (for high max_tokens) when LLM is enabled; otherwise local heuristics.
 */
import { randomUUID } from 'node:crypto';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import type {
  AnalyzeCvAcceptedResponse,
  AnalyzeCvRequest,
  AnalyzeCvResult,
  AtsCheck,
  BulletEvaluation,
  FormatCheck,
  JdAlignment,
  KeywordHighlight,
  RewriteSuggestion,
} from '@advance-academy/contracts/cv-optimizer';
import type { ApiErrorResponse, JobStatusResponse } from '@advance-academy/contracts/jobs';
import { getLlmConfig } from '../config/llm.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';

const cvAnalysisJobs = new Map<string, JobStatusResponse<AnalyzeCvResult>>();

// ─── Template ─────────────────────────────────────────────────────────────────

export function getAnalyzeTemplate() {
  const llmConfig = getLlmConfig('cvOptimizer');

  return {
    endpoint: '/api/cv-optimizer/analyze',
    method: 'POST',
    statusEndpoint: '/api/cv-optimizer/jobs/:jobId',
    description: 'CV analysis endpoint. Returns a job id immediately, then the client polls the job endpoint until the analysis is completed.',
    llm: {
      enabled: llmConfig.enabled,
      provider: llmConfig.provider,
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl,
    },
    expectedBody: {
      targetRole: 'Frontend Developer',
      currentCvText: 'Paste CV text here...',
      jobDescription: 'Optional target job description...',
    },
  };
}

// ─── Job helpers ───────────────────────────────────────────────────────────────

function updateJob(jobId: string, updates: Partial<JobStatusResponse<AnalyzeCvResult>>) {
  const currentJob = cvAnalysisJobs.get(jobId);
  if (!currentJob) return;
  cvAnalysisJobs.set(jobId, { ...currentJob, ...updates, updatedAt: new Date().toISOString() });
}

function buildJobError(message: string, details?: unknown): ApiErrorResponse {
  return { code: 'CV_ANALYSIS_FAILED', message, details };
}

// ─── Fallback (no LLM) ────────────────────────────────────────────────────────

function buildFallbackAnalysis(body: AnalyzeCvRequest): AnalyzeCvResult {
  const cvText = body.currentCvText.trim();
  const targetRole = body.targetRole.trim();
  const hasMetrics = /\b\d+%|\b\d+\+|\$\d+|\b\d+\s?(users|projects|clients|sales|team members)\b/i.test(cvText);
  const hasActionVerbs = /\b(built|led|improved|designed|launched|implemented|optimized|created|delivered)\b/i.test(cvText);
  const hasJobDescription = Boolean(body.jobDescription?.trim());

  const sections = [
    {
      title: 'Technical Skills',
      score: cvText.toLowerCase().includes(targetRole.toLowerCase()) ? 86 : 74,
      feedback: cvText.length > 250
        ? 'Your CV has enough detail to evaluate skills. Add more role-specific keywords if you want stronger matching.'
        : 'Add a clearer technical skills section with tools, frameworks, and certifications relevant to the role.',
    },
    {
      title: 'Experience',
      score: hasMetrics ? 84 : 70,
      feedback: hasMetrics
        ? 'Good use of measurable impact. Keep quantifying achievements in each role.'
        : 'Your experience will read stronger if each bullet includes metrics, outcomes, or business impact.',
    },
    {
      title: 'Role Alignment',
      score: hasJobDescription ? 82 : 68,
      feedback: hasJobDescription
        ? 'The target job description gives you a solid base for tailoring your CV.'
        : 'Include a target job description so the analysis can compare your CV against a specific role.',
    },
    {
      title: 'Writing Impact',
      score: hasActionVerbs ? 80 : 66,
      feedback: hasActionVerbs
        ? 'Your wording shows action and ownership. Keep using strong verbs at the start of bullet points.'
        : 'Start bullets with stronger action verbs like built, led, improved, or implemented.',
    },
  ];

  const overallScore = Math.round(sections.reduce((s, sec) => s + sec.score, 0) / sections.length);

  return {
    overallScore,
    sections,
    expertReview: [
      `This CV shows a solid starting point for a ${targetRole} application.`,
      hasMetrics
        ? 'The document already includes some measurable impact, which helps credibility.'
        : 'The biggest improvement area is adding measurable achievements and clearer outcomes.',
      hasJobDescription
        ? 'Because a job description was provided, this analysis can be extended into job-specific tailoring.'
        : 'Once you provide a target job description, this endpoint can evolve into a more tailored review.',
    ].join(' '),
    keywordHighlights: [],
    atsCheck: { score: 0, issues: ['LLM not configured — ATS check unavailable.'], passed: [] },
    formatCheck: { issues: [], suggestions: ['Enable LLM to get format and typo analysis.'] },
    bulletEvaluations: [],
    rewriteSuggestions: [],
    jdAlignment: {
      matchedRequirements: [],
      missingRequirements: [],
      alignmentSummary: hasJobDescription
        ? 'Enable LLM for a detailed JD alignment analysis.'
        : 'No job description provided.',
    },
  };
}

// ─── LLM analysis ─────────────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function safeArray<T>(val: unknown, fallback: T[] = []): T[] {
  return Array.isArray(val) ? (val as T[]) : fallback;
}

function safeString(val: unknown, fallback = ''): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

function safeNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

function normalizeResult(targetRole: string, raw: Partial<AnalyzeCvResult>): AnalyzeCvResult {
  const sections = safeArray<AnalyzeCvResult['sections'][number]>(raw.sections)
    .map((s) => ({
      title: safeString(s?.title),
      score: safeNumber(s?.score),
      feedback: safeString(s?.feedback),
    }))
    .filter((s) => s.title && s.feedback);

  if (sections.length === 0) {
    throw new Error('LLM result did not include any valid sections.');
  }

  const rawAts = (raw.atsCheck ?? {}) as Partial<AtsCheck>;
  const rawFmt = (raw.formatCheck ?? {}) as Partial<FormatCheck>;
  const rawAlignment = (raw.jdAlignment ?? {}) as Partial<JdAlignment>;

  return {
    overallScore: safeNumber(raw.overallScore),
    sections,
    expertReview: safeString(raw.expertReview, `This CV has been reviewed for the ${targetRole} role.`),
    keywordHighlights: safeArray<KeywordHighlight>(raw.keywordHighlights),
    atsCheck: {
      score: safeNumber(rawAts.score),
      issues: safeArray<string>(rawAts.issues),
      passed: safeArray<string>(rawAts.passed),
    },
    formatCheck: {
      issues: safeArray<string>(rawFmt.issues),
      suggestions: safeArray<string>(rawFmt.suggestions),
    },
    bulletEvaluations: safeArray<BulletEvaluation>(raw.bulletEvaluations),
    rewriteSuggestions: safeArray<RewriteSuggestion>(raw.rewriteSuggestions),
    jdAlignment: {
      matchedRequirements: safeArray<string>(rawAlignment.matchedRequirements),
      missingRequirements: safeArray<string>(rawAlignment.missingRequirements),
      alignmentSummary: safeString(rawAlignment.alignmentSummary),
    },
  };
}

const SYSTEM_PROMPT = `You are an expert CV reviewer, ATS specialist, and career coach.
You will receive a CV and optionally a Job Description. Analyze the CV thoroughly and return ONLY a single valid JSON object — no markdown, no explanation, no preamble.

The JSON must match this exact structure:
{
  "overallScore": <integer 0–100>,
  "sections": [
    { "title": string, "score": <integer 0–100>, "feedback": string }
  ],
  "expertReview": string,
  "keywordHighlights": [
    { "keyword": string, "foundInCv": boolean, "category": "required_skill" | "tech_stack" | "nice_to_have" }
  ],
  "atsCheck": {
    "score": <integer 0–100>,
    "issues": [string],
    "passed": [string]
  },
  "formatCheck": {
    "issues": [string],
    "suggestions": [string]
  },
  "bulletEvaluations": [
    { "original": string, "hasImpact": boolean, "impactScore": <integer 1–10>, "feedback": string }
  ],
  "rewriteSuggestions": [
    { "section": string, "current": string, "suggested": string, "reason": string }
  ],
  "jdAlignment": {
    "matchedRequirements": [string],
    "missingRequirements": [string],
    "alignmentSummary": string
  }
}

Rules:
- sections: produce exactly 4 items covering Technical Skills, Experience, Role Alignment, Writing Impact
- keywordHighlights: extract every named technology, tool, language, framework, and method from the JD; mark each as found or missing in the CV; classify as required_skill, tech_stack, or nice_to_have
- atsCheck: evaluate for ATS compatibility (no tables, no graphics, standard headings, correct date formats, measurable content). Score 0–100. List specific issues and what passed
- formatCheck: flag any typos, inconsistent capitalisation, inconsistent date formats, punctuation issues, or missing section headers
- bulletEvaluations: evaluate every experience bullet in the CV. Score impact 1–10. Be strict — vague bullets score 1–4
- rewriteSuggestions: provide 3–6 concrete rewrites targeting the weakest bullets and summary. Show the original and improved version side by side with the reason
- jdAlignment: list specific JD requirements that are clearly evidenced in the CV vs clearly absent
- expertReview: 3–5 sentence holistic verdict, referencing specific evidence from the CV
- Do not invent facts. Do not be encouraging if the CV is weak. Score what is actually present.`;

async function buildLlmAnalysis(body: AnalyzeCvRequest): Promise<AnalyzeCvResult | null> {
  assertLlmConfigured('cvOptimizer');

  const anthropic = createAnthropicClient();
  const model = getFeatureModel('cvOptimizer');

  const userPrompt = [
    `TARGET ROLE: ${body.targetRole}`,
    '',
    '=== CV ===',
    body.currentCvText,
    '',
    body.jobDescription?.trim()
      ? `=== JOB DESCRIPTION ===\n${body.jobDescription.trim()}`
      : '(No job description provided — evaluate the CV against the target role only.)',
  ].join('\n');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') return null;

  const raw = JSON.parse(stripJsonFences(block.text)) as Partial<AnalyzeCvResult>;
  return normalizeResult(body.targetRole.trim(), raw);
}

// ─── Job runner ───────────────────────────────────────────────────────────────

async function analyzeCv(body: AnalyzeCvRequest): Promise<AnalyzeCvResult> {
  if (!getLlmConfig('cvOptimizer').enabled) {
    return buildFallbackAnalysis(body);
  }

  try {
    const result = await buildLlmAnalysis(body);
    if (result) return result;
  } catch (error) {
    console.error('Falling back to local CV analysis after LLM error.', error);
  }

  return buildFallbackAnalysis(body);
}

async function runCvAnalysisJob(jobId: string, body: AnalyzeCvRequest) {
  updateJob(jobId, { status: 'running', error: undefined });

  try {
    const result = await analyzeCv(body);
    updateJob(jobId, { status: 'completed', result, error: undefined });
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      result: undefined,
      error: buildJobError('The CV analysis job failed.', error instanceof Error ? error.message : error),
    });
  }
}

export async function createCvAnalysisJob(body: AnalyzeCvRequest): Promise<AnalyzeCvAcceptedResponse> {
  const timestamp = new Date().toISOString();
  const jobId = randomUUID();

  cvAnalysisJobs.set(jobId, { jobId, status: 'queued', submittedAt: timestamp, updatedAt: timestamp });
  setTimeout(() => { void runCvAnalysisJob(jobId, body); }, 50);

  return { jobId, status: 'queued', submittedAt: timestamp, updatedAt: timestamp };
}

export function getCvAnalysisJob(jobId: string) {
  return cvAnalysisJobs.get(jobId) ?? null;
}

// ─── File parsing ─────────────────────────────────────────────────────────────

export async function extractFileText(buffer: Buffer, fileNameLower: string): Promise<string> {
  if (!fileNameLower.endsWith('.pdf') && !fileNameLower.endsWith('.docx')) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  let text: string;

  if (fileNameLower.endsWith('.pdf')) {
    const pdfData = await pdfParse(buffer);
    text = pdfData.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }

  if (!text.trim()) {
    throw Object.assign(new Error('Could not extract text from the uploaded file'), { statusCode: 422 });
  }

  return text.trim();
}
