export interface LinkedInProfileRaw {
  headline: string;
  about: string;
  experience: {
    title: string;
    company: string;
    description: string;
    duration: string;
  }[];
  skills: string[];
  posts?: string[];
}

export interface ProfileSignal {
  name: string;
  currentTitle: string;
  background: string;
  differentiators: string[];
  proofPoints: string[];
  topSkills: string[];
  industries: string[];
  yearsExperience: number;
  employmentStatus: string;
  availability: string;
  tone: 'direct' | 'warm' | 'analytical' | 'storytelling' | 'conversational';
  vocabularyStyle: 'formal' | 'casual' | 'technical' | 'hybrid';
  preferredFraming: 'data-driven' | 'narrative' | 'outcome-focused';
}

export interface TargetData {
  name: string;
  role: string;
  company: string;
  industry: string;
  recentActivity?: string;
  whyThisCompany: string;
  companySignal?: string;
  hiringManager?: string;
  hiringManagerRole?: string;
}

export interface RoleData {
  title: string;
  department: string;
  keyRequirements: string[];
  impliedPain: string;
}

export interface RecruiterData {
  name: string;
  type: 'agency' | 'in-house';
  specialization: string;
  activeRoles?: string[];
}

export interface DesiredRole {
  title: string;
  location: string;
  salaryExpectation?: string;
}

export interface EmailOutput {
  subjectLines: {
    curiosity: string;
    specific: string;
    direct: string;
  };
  body: string;
}

export interface RecruiterPitchOutput {
  pitch: string;
  warning?: string;
}

export interface OutreachResult {
  senderSignal: ProfileSignal;
  linkedInMessage: string;
  email: EmailOutput;
  recruiterPitch: RecruiterPitchOutput;
}

export interface OutreachRequest {
  rawProfile: LinkedInProfileRaw;
  targetData: TargetData;
  roleData: RoleData;
  recruiterData: RecruiterData;
  desiredRole: DesiredRole;
}
