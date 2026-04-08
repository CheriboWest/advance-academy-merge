export type OutreachIntent =
  | 'direct_application'
  | 'referral_request'
  | 'informational_interview'
  | 'agency_recruiter';

export type ExperienceLevel = 'senior' | 'mid' | 'fresher' | 'intern';

export interface OutreachOutputs {
  email: boolean;
  linkedIn: boolean;
}

export interface OutreachRequest {
  cvText: string;
  portfolioText?: string;
  targetCompany: string;
  targetPersonName?: string;
  targetRole: string;
  experienceLevel: ExperienceLevel;
  intent: OutreachIntent;
  hiringSignalUrl?: string;
  hiringSignalExaText?: string;
  socialSignalUrl?: string;
  socialSignalExaText?: string;
  outputs: OutreachOutputs;
}

export interface OutreachEmail {
  subject: string;
  body: string;
}

export interface OutreachResult {
  intent: OutreachIntent;
  linkedInMessage?: string;
  email?: OutreachEmail;
}

export interface EnrichmentRequest {
  companyName: string;
  targetRole: string;
  experienceLevel: ExperienceLevel;
  personName?: string;
}

export interface EnrichmentCard {
  title: string;
  url: string;
  snippet: string;
  isBlockedDomain: boolean;
  exaText: string;
}

export interface EnrichmentResponse {
  hiringResults: EnrichmentCard[];
  socialResults: EnrichmentCard[];
}
