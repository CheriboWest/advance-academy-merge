import type { DreamCompanyInput, ProfileAnalysis } from '../../types/dream-company.js';

export function buildProfileAnalysisPrompt(profile: DreamCompanyInput): string {
  return `You are a senior career strategist with 20 years of experience assessing professionals across industries. You are direct, honest, and never inflate assessments to be encouraging.

Analyze the following candidate profile and produce a comprehensive market assessment.

CANDIDATE PROFILE:
- Degree: ${profile.degree}
- Work Experience: ${profile.workExperience}
- Skills: ${profile.skills}
- Interests: ${profile.interests}
- Target Salary: ${profile.targetSalary}
- Location: ${profile.location}

YOUR TASK:
1. Determine the candidate's market level (entry, junior, mid, senior, lead, or executive) based on their experience and skills. Provide a clear rationale.
2. Estimate a realistic salary range for their level and location. Include the currency and a note about market conditions.
3. Identify 3-5 core strengths with specific evidence from their profile (quote exact skills or experience details).
4. Identify 2-4 critical gaps that could hold them back, with impact description and urgency rating (high, medium, or low).
5. Write a unique value proposition — one sentence that captures what makes this specific candidate stand out.
6. Assign a readinessScore from 0-100 representing how ready they are to land their target role, with a note explaining the score.

Be honest and direct. Do not inflate the assessment to be encouraging. Base every claim on evidence from the profile.

Return ONLY a valid JSON object matching this exact schema:
{
  "marketLevel": "entry" | "junior" | "mid" | "senior" | "lead" | "executive",
  "marketLevelRationale": "string",
  "salaryRange": { "min": number, "max": number, "currency": "string", "note": "string" },
  "coreStrengths": [{ "strength": "string", "evidence": "string" }],
  "criticalGaps": [{ "gap": "string", "impact": "string", "urgency": "high" | "medium" | "low" }],
  "uniqueValueProposition": "string",
  "readinessScore": number,
  "readinessNote": "string"
}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks.`;
}

export function buildCompanyMatrixPrompt(profile: DreamCompanyInput, analysis: ProfileAnalysis): string {
  return `You are a headhunter with 15 years of experience placing candidates at companies ranging from early-stage startups to Fortune 500 corporations. You have deep knowledge of hiring practices, company cultures, and talent markets.

Based on the candidate profile and their market assessment below, generate a targeted company matrix.

CANDIDATE PROFILE:
- Degree: ${profile.degree}
- Work Experience: ${profile.workExperience}
- Skills: ${profile.skills}
- Interests: ${profile.interests}
- Target Salary: ${profile.targetSalary}
- Location: ${profile.location}

MARKET ASSESSMENT:
- Market Level: ${analysis.marketLevel}
- Rationale: ${analysis.marketLevelRationale}
- Readiness Score: ${analysis.readinessScore}/100
- Core Strengths: ${analysis.coreStrengths.map((s) => s.strength).join(', ')}
- Critical Gaps: ${analysis.criticalGaps.map((g) => g.gap).join(', ')}
- Unique Value: ${analysis.uniqueValueProposition}

YOUR TASK:
Generate exactly 20 companies organized into 3 tiers:
- Tier 1 (5 companies): Aspirational — dream companies that would be a stretch but achievable with preparation
- Tier 2 (10 companies): Sweet Spot — companies where this candidate is a strong match right now
- Tier 3 (5 companies): High Probability — companies where the candidate would likely get hired quickly

For each company provide:
- name: the real company name (must be a real, currently operating business)
- industry: the company's primary industry
- why: a specific reason this company fits THIS candidate — reference their actual skills or experience
- likelyRole: a specific, real job title (not a category) they would apply for
- challenge: the biggest obstacle this candidate would face in getting hired there
- hiringSignal: always set this to "unknown"
- tier: 1, 2, or 3

RULES:
- All companies must be real, currently operating businesses
- All companies must be relevant to ${profile.location} (either headquartered there, have offices there, or hire remotely for that region)
- The "why" field must reference specific skills or experience from this candidate's profile
- The "likelyRole" must be a real job title, not a generic category
- The "hiringSignal" must always be "unknown"

Return ONLY a valid JSON object matching this exact schema:
{
  "tier1": {
    "label": "string",
    "description": "string",
    "companies": [{ "name": "string", "industry": "string", "why": "string", "likelyRole": "string", "challenge": "string", "hiringSignal": "unknown", "tier": 1 }]
  },
  "tier2": {
    "label": "string",
    "description": "string",
    "companies": [{ "name": "string", "industry": "string", "why": "string", "likelyRole": "string", "challenge": "string", "hiringSignal": "unknown", "tier": 2 }]
  },
  "tier3": {
    "label": "string",
    "description": "string",
    "companies": [{ "name": "string", "industry": "string", "why": "string", "likelyRole": "string", "challenge": "string", "hiringSignal": "unknown", "tier": 3 }]
  }
}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks.`;
}

export function buildTargetRolesPrompt(profile: DreamCompanyInput, analysis: ProfileAnalysis): string {
  return `You are a talent acquisition specialist with 12 years of experience matching candidates to roles across tech, finance, consulting, and other industries. You understand job market dynamics and hiring trends deeply.

Based on the candidate profile and market assessment below, identify the 10 best-fit job roles for this candidate.

CANDIDATE PROFILE:
- Degree: ${profile.degree}
- Work Experience: ${profile.workExperience}
- Skills: ${profile.skills}
- Interests: ${profile.interests}
- Target Salary: ${profile.targetSalary}
- Location: ${profile.location}

MARKET ASSESSMENT:
- Market Level: ${analysis.marketLevel}
- Rationale: ${analysis.marketLevelRationale}
- Salary Range: ${analysis.salaryRange.min}-${analysis.salaryRange.max} ${analysis.salaryRange.currency}
- Core Strengths: ${analysis.coreStrengths.map((s) => `${s.strength} (${s.evidence})`).join('; ')}
- Critical Gaps: ${analysis.criticalGaps.map((g) => `${g.gap} (${g.urgency} urgency)`).join('; ')}
- Unique Value: ${analysis.uniqueValueProposition}
- Readiness Score: ${analysis.readinessScore}/100

YOUR TASK:
Identify exactly 10 job titles that fit this candidate. For each role provide:
- title: specific job title (e.g., "Senior Frontend Engineer", not just "Engineer")
- level: seniority level (e.g., "Senior", "Mid-Level", "Lead")
- fitScore: 0-100 how well this candidate matches the typical requirements
- fitReason: specific explanation tied to their actual skills and experience
- demandLevel: current market demand for this role — "high", "medium", or "low"
- avgSalary: average salary for this role in ${profile.location}

Order the roles from highest fitScore to lowest.

Return ONLY a valid JSON array matching this exact schema:
[{
  "title": "string",
  "level": "string",
  "fitScore": number,
  "fitReason": "string",
  "demandLevel": "high" | "medium" | "low",
  "avgSalary": "string"
}]

Return ONLY a valid JSON array. No explanation, no markdown, no code blocks.`;
}

export function buildCareerRoadmapPrompt(profile: DreamCompanyInput, analysis: ProfileAnalysis): string {
  return `You are an executive career coach with 18 years of experience helping professionals advance from ${analysis.marketLevel}-level positions to leadership roles. You build actionable, specific career plans — never generic advice.

Based on the candidate profile and market assessment below, build a 3-phase career roadmap.

CANDIDATE PROFILE:
- Degree: ${profile.degree}
- Work Experience: ${profile.workExperience}
- Skills: ${profile.skills}
- Interests: ${profile.interests}
- Target Salary: ${profile.targetSalary}
- Location: ${profile.location}

MARKET ASSESSMENT:
- Market Level: ${analysis.marketLevel}
- Readiness Score: ${analysis.readinessScore}/100
- Core Strengths: ${analysis.coreStrengths.map((s) => s.strength).join(', ')}
- Critical Gaps: ${analysis.criticalGaps.map((g) => `${g.gap} (${g.urgency} urgency, impact: ${g.impact})`).join('; ')}
- Unique Value: ${analysis.uniqueValueProposition}
- Readiness Note: ${analysis.readinessNote}

YOUR TASK:
Build exactly 3 phases:
- Phase 1 (0-6 months): Foundation building and quick wins
- Phase 2 (6-18 months): Growth and positioning
- Phase 3 (2-5 years): Career advancement and leadership

For each phase provide:
- phase: the phase number (1, 2, or 3)
- duration: the time range (e.g., "0-6 months")
- goal: one clear overarching goal for this phase
- actions: 4-6 specific, actionable steps (e.g., "Build a portfolio project using React and TypeScript showcasing data visualization" not "improve your skills")
- skills: 3-5 specific skills to develop during this phase
- milestone: one concrete, measurable milestone that proves this phase is complete

RULES:
- Actions must be specific to this candidate's profile, not generic career advice
- Reference their actual skills, gaps, and interests
- Each milestone must be measurable and concrete
- Skills should address identified gaps from the assessment

Return ONLY a valid JSON object matching this exact schema:
{
  "phases": [{
    "phase": number,
    "duration": "string",
    "goal": "string",
    "actions": ["string"],
    "skills": ["string"],
    "milestone": "string"
  }]
}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks.`;
}
