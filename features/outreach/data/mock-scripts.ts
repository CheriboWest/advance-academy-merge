interface OutreachScript {
  type: string
  content: string
}

export const MOCK_SCRIPTS: OutreachScript[] = [
  {
    type: 'LinkedIn Message',
    content: 'Hi [Recruiter Name], I noticed your recent post about [specific project]. Your work aligns perfectly with my background in [relevant skill]. I\'d love to discuss potential opportunities at [Company]. Looking forward to connecting!',
  },
  {
    type: 'Email Outreach',
    content: 'Subject: Excited to discuss [role] at [Company]\n\nDear [Hiring Manager],\n\nI\'ve followed [Company]\'s impressive growth in [industry]. With [X years] experience in [skill set], I\'m excited about the opportunity to contribute to your team. Let\'s schedule a brief call?\n\nBest regards,\n[Your Name]',
  },
  {
    type: 'Phone Script',
    content: 'Hi [Name], I hope I\'m not catching you at a bad time. I\'m calling because I\'m very interested in [specific role] at [Company]. I\'ve admired your work in [industry], and I believe my background in [skill] could be valuable. Would you have 15 minutes next week to discuss?',
  },
]
