import type { NavItem, CompanyResult, OutreachScript, CVReview } from '@/lib/types'

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', view: 'home' },
  { label: 'Dream Company', view: 'companies' },
  { label: 'Outreach', view: 'outreach' },
  { label: 'CV Optimizer', view: 'cv' },
  { label: 'Interview Prep', view: 'interview' },
  { label: 'History', view: 'history' },
]

export const MOCK_COMPANIES: CompanyResult[] = [
  { name: 'TechFlow Systems', industry: 'Software', location: 'San Francisco, CA', match: 94 },
  { name: 'DataMind Analytics', industry: 'Data Science', location: 'New York, NY', match: 91 },
  { name: 'CloudVenture Inc', industry: 'Cloud Computing', location: 'Seattle, WA', match: 88 },
]

export const MOCK_SCRIPTS: OutreachScript[] = [
  {
    type: 'LinkedIn Message',
    content: 'Hi [Recruiter Name], I noticed your recent post about [specific project]. Your work aligns perfectly with my background in [relevant skill]. I\'d love to discuss potential opportunities at [Company]. Looking forward to connecting!'
  },
  {
    type: 'Email Outreach',
    content: 'Subject: Excited to discuss [role] at [Company]\n\nDear [Hiring Manager],\n\nI\'ve followed [Company]\'s impressive growth in [industry]. With [X years] experience in [skill set], I\'m excited about the opportunity to contribute to your team. Let\'s schedule a brief call?\n\nBest regards,\n[Your Name]'
  },
  {
    type: 'Phone Script',
    content: 'Hi [Name], I hope I\'m not catching you at a bad time. I\'m calling because I\'m very interested in [specific role] at [Company]. I\'ve admired your work in [industry], and I believe my background in [skill] could be valuable. Would you have 15 minutes next week to discuss?'
  }
]

export const MOCK_CV_REVIEW: CVReview = {
  overallScore: 78,
  sections: [
    { title: 'Technical Skills', score: 85, feedback: 'Strong technical keywords. Consider adding more specific technologies and certifications.' },
    { title: 'Experience', score: 75, feedback: 'Good structure. Add more quantifiable results (e.g., "increased revenue by 40%").' },
    { title: 'Education', score: 74, feedback: 'Complete but could highlight relevant certifications and relevant coursework.' }
  ],
  expertReview: 'Your CV has solid foundations. Focus on adding metrics and quantifiable impact to each role. Also consider tailoring it for specific job descriptions you apply to. Using more action verbs will strengthen your impact statements.'
}
