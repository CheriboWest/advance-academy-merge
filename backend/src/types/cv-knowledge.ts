export type DetectedField = 'tech' | 'business' | 'marketing' | null;

export interface CvVersionRow {
  id: string;
  user_id: string;
  name: string;
  source_file_path: string | null;
  raw_text: string;
  detected_field: DetectedField;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CvVersionSummary {
  id: string;
  name: string;
  detectedField: DetectedField;
  isActive: boolean;
  bulletCount: number;
  openGapCount: number;
  createdAt: string;
}

export interface CvBulletRow {
  id: string;
  cv_version_id: string;
  section_path: string | null;
  bullet_text: string;
  ordinal: number;
  created_at: string;
}

export interface BulletGapRow {
  id: string;
  bullet_id: string;
  question: string;
  rationale: string | null;
  ordinal: number;
  status: 'open' | 'answered' | 'skipped';
  created_at: string;
  updated_at: string;
}

export interface BulletArtifactRow {
  id: string;
  gap_id: string;
  source_type: 'text' | 'file' | 'url' | 'jit_clarification';
  content_text: string | null;
  source_url: string | null;
  source_file_path: string | null;
  summary_json: ArtifactSummary | null;
  created_at: string;
}

export interface ArtifactSummary {
  overview: string;
  my_contribution: string;
  concrete_facts: string[];
  metrics: string[];
}

export interface BulletWithGaps {
  id: string;
  sectionPath: string | null;
  bulletText: string;
  ordinal: number;
  gaps: Array<{
    id: string;
    question: string;
    rationale: string | null;
    ordinal: number;
    status: 'open' | 'answered' | 'skipped';
    artifacts: Array<{
      id: string;
      sourceType: BulletArtifactRow['source_type'];
      contentText: string | null;
      sourceUrl: string | null;
      summary: ArtifactSummary | null;
      createdAt: string;
    }>;
  }>;
}

export interface CoachAnswerRequest {
  question: string;
  answer: string;
  context: {
    jobTitle: string;
    jobDescription: string;
    companyName: string;
  };
  cvVersionId?: string;
  irsScore?: {
    integrity: number;
    relevance: number;
    substance: number;
    overall: number;
  };
}

export interface MissingEvidencePrompt {
  bulletId: string | null;
  bulletText: string | null;
  question: string;
}

export interface CoachAnswerResponse {
  critique: string;
  improvedAnswer: string;
  missingEvidencePrompts: MissingEvidencePrompt[];
}
