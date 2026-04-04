import type { DreamCompanyInput, DreamCompanyResult } from '@/types/dream-company'

export async function generateDreamCompanies(
  profile: DreamCompanyInput
): Promise<DreamCompanyResult> {
  const response = await fetch('/api/dream-company/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Generation failed')
  }

  return response.json()
}

export interface CVParseResponse {
  degree: string
  workExperience: string
  skills: string
  interests: string
  targetSalary: string
  location: string
  currentLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'manager' | 'director' | 'executive'
  confidence: {
    degree: 'high' | 'medium' | 'low'
    workExperience: 'high' | 'medium' | 'low'
    skills: 'high' | 'medium' | 'low'
    location: 'high' | 'medium' | 'low'
  }
}

export async function parseCV(file: File): Promise<CVParseResponse> {
  const formData = new FormData()
  formData.append('cv', file)

  const response = await fetch('/api/dream-company/parse-cv', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'CV parsing failed')
  }

  return response.json()
}
