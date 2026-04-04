import { randomUUID } from 'node:crypto';
import type { AnalyzeCvAcceptedResponse, AnalyzeCvRequest, AnalyzeCvResult } from '@advance-academy/contracts/cv-optimizer';
import type { ApiErrorResponse, JobStatusResponse } from '@advance-academy/contracts/jobs';
import { getLlmConfig } from '../config/llm.js';
import { generateJson } from './llm.service.js';

const cvAnalysisJobs = new Map<string, JobStatusResponse<AnalyzeCvResult>>();

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
      candidateName: 'Jane Doe',
      targetRole: 'Frontend Developer',
      currentCvText: 'Paste CV text here...',
      jobDescription: 'Optional target job description...',
    },
    acceptedResponseShape: {
      jobId: 'uuid',
      status: 'queued',
      submittedAt: 'ISO date',
      updatedAt: 'ISO date',
    },
    jobResponseShape: {
      jobId: 'uuid',
      status: 'completed',
      submittedAt: 'ISO date',
      updatedAt: 'ISO date',
      result: {
        overallScore: 0,
        sections: [
          {
            title: 'Technical Skills',
            score: 0,
            feedback: 'Section feedback',
          },
        ],
        expertReview: 'Summary feedback',
      },
    },
  };
}

function updateJob(jobId: string, updates: Partial<JobStatusResponse<AnalyzeCvResult>>) {
  const currentJob = cvAnalysisJobs.get(jobId);

  if (!currentJob) {
    return;
  }

  cvAnalysisJobs.set(jobId, {
    ...currentJob,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}

function buildJobError(message: string, details?: unknown): ApiErrorResponse {
  return {
    code: 'CV_ANALYSIS_FAILED',
    message,
    details,
  };
}

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

  const overallScore = Math.round(
    sections.reduce((sum, section) => sum + section.score, 0) / sections.length,
  );

  return {
    overallScore,
    sections,
    expertReview: [
      `${body.candidateName.trim()}'s CV shows a solid starting point for a ${targetRole} application.`,
      hasMetrics
        ? 'The document already includes some measurable impact, which helps credibility.'
        : 'The biggest improvement area is adding measurable achievements and clearer outcomes.',
      hasJobDescription
        ? 'Because a job description was provided, this template can be extended into job-specific tailoring next.'
        : 'Once you provide a target job description, this endpoint can evolve into a more tailored review.',
    ].join(' '),
  };
}

function normalizeResult(candidateName: string, targetRole: string, result: Partial<AnalyzeCvResult>): AnalyzeCvResult {
  const sanitizedSections = Array.isArray(result.sections)
    ? result.sections
        .map((section: AnalyzeCvResult['sections'][number]) => ({
          title: typeof section?.title === 'string' ? section.title.trim() : '',
          score: Math.max(0, Math.min(100, Math.round(Number(section?.score ?? 0)))),
          feedback: typeof section?.feedback === 'string' ? section.feedback.trim() : '',
        }))
        .filter((section: AnalyzeCvResult['sections'][number]) => section.title && section.feedback)
    : [];

  if (sanitizedSections.length === 0) {
    throw new Error('LLM result did not include any valid sections.');
  }

  return {
    overallScore: Math.max(0, Math.min(100, Math.round(Number(result.overallScore ?? 0)))),
    sections: sanitizedSections,
    expertReview: typeof result.expertReview === 'string' && result.expertReview.trim().length > 0
      ? result.expertReview.trim()
      : `${candidateName}'s CV has been reviewed for the ${targetRole} role.`,
  };
}

async function buildLlmAnalysis(body: AnalyzeCvRequest) {
  const result = await generateJson<AnalyzeCvResult>({
    feature: 'cvOptimizer',
    systemPrompt: [
      'You are an expert CV reviewer for job applications.',
      'Return valid JSON only.',
      'Score strictly from 0 to 100.',
      'Respond with keys overallScore, sections, and expertReview.',
      'sections must be an array of 3 to 5 objects with title, score, and feedback.',
      'Keep feedback concrete, concise, and actionable.',
    ].join(' '),
    userPrompt: JSON.stringify({
      task: 'Analyze this CV for the target role and produce structured review JSON.',
      candidateName: body.candidateName,
      targetRole: body.targetRole,
      currentCvText: body.currentCvText,
      jobDescription: body.jobDescription ?? '',
    }),
  });

  if (!result) {
    return null;
  }

  return normalizeResult(body.candidateName.trim(), body.targetRole.trim(), result);
}

async function analyzeCv(body: AnalyzeCvRequest): Promise<AnalyzeCvResult> {
  if (!getLlmConfig('cvOptimizer').enabled) {
    return buildFallbackAnalysis(body);
  }

  try {
    const llmResult = await buildLlmAnalysis(body);

    if (llmResult) {
      return llmResult;
    }
  } catch (error) {
    console.error('Falling back to local CV analysis after LLM error.', error);
  }

  return buildFallbackAnalysis(body);
}

async function runCvAnalysisJob(jobId: string, body: AnalyzeCvRequest) {
  updateJob(jobId, { status: 'running', error: undefined });

  try {
    const result = await analyzeCv(body);

    updateJob(jobId, {
      status: 'completed',
      result,
      error: undefined,
    });
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

  cvAnalysisJobs.set(jobId, {
    jobId,
    status: 'queued',
    submittedAt: timestamp,
    updatedAt: timestamp,
  });

  setTimeout(() => {
    void runCvAnalysisJob(jobId, body);
  }, 50);

  return {
    jobId,
    status: 'queued',
    submittedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getCvAnalysisJob(jobId: string) {
  return cvAnalysisJobs.get(jobId) ?? null;
}
