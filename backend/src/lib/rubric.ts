export interface RubricDimension {
  dimension: string;
  weight: number;
  description: string;
  scale: string;
}

export const ScoringRubric: RubricDimension[] = [
  {
    dimension: 'skills_coverage',
    weight: 0.30,
    description: 'Does the CV demonstrate the required skills from the JD, including adjacent and transferable skills?',
    scale: '1 = none of the required skills present, 10 = all required and nice-to-have skills clearly demonstrated',
  },
  {
    dimension: 'experience_relevance',
    weight: 0.30,
    description: "Is the candidate's experience domain, industry, and seniority a genuine match for this role?",
    scale: '1 = completely unrelated experience, 10 = directly relevant experience at the right level',
  },
  {
    dimension: 'achievement_quality',
    weight: 0.20,
    description: "Are the candidate's achievements backed by metrics, outcomes, and proof of real impact?",
    scale: '1 = no metrics or outcomes anywhere, 10 = every bullet has a measurable result',
  },
  {
    dimension: 'seniority_alignment',
    weight: 0.20,
    description: "Does the candidate's level, scope of responsibility, and career trajectory match what the role requires?",
    scale: '1 = significant mismatch in level, 10 = perfect seniority match',
  },
];

export interface RubricScore {
  dimension: string;
  score: number;       // 1–10
  reasoning: string;   // one sentence, mandatory
}

export interface ScoringResult {
  semanticScore: number;         // 0–100, from embeddings
  rubricScores: RubricScore[];   // one per dimension
  weightedRubricScore: number;   // 0–100, weighted average
  finalScore: number;            // composite: semantic 40% + rubric 60%
  matchedKeywords: string[];
  missingKeywords: string[];
}
