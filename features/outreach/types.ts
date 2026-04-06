export type OutreachIntent =
  | 'direct_application'
  | 'referral_request'
  | 'informational_interview'
  | 'agency_recruiter';

export interface EnrichedContext {
  type: string;
  content: string;
}

export interface OutreachRequest {
  cvText: string;
  linkedInText?: string;
  targetCompany: string;
  targetPersonName: string;
  targetPersonRole?: string;
  enrichedContexts: EnrichedContext[];
  intent: OutreachIntent;
}

export interface OutreachResult {
  intent: OutreachIntent;
  linkedInMessage: string;
  email: {
    subject: string;
    body: string;
  };
}

export interface OutreachContextLink {
  id: string;
  meaning: string;
  url: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  extractedText: string;
  errorMessage?: string;
}

export interface OutreachFormData {
  cvText: string;
  linkedInText: string;
  targetCompany: string;
  targetPersonName: string;
  targetPersonRole: string;
  contextLinks: OutreachContextLink[];
  intent: OutreachIntent;
}

export interface OutreachScript {
  type: string;
  content: string;
}
