import type { AnalyzeCvDto } from '../types/cv-optimizer';

export function getAnalyzeTemplate() {
  return {
    endpoint: '/api/cv-optimizer/analyze',
    method: 'POST',
    description: 'Template endpoint for CV analysis. Replace this mock logic with file parsing and AI analysis later.',
    expectedBody: {
      candidateName: 'Jane Doe',
      targetRole: 'Frontend Developer',
      currentCvText: 'Paste CV text here...',
      jobDescription: 'Optional target job description...',
    },
    responseShape: {
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
  };
}

export function analyzeCv(body: AnalyzeCvDto) {
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
