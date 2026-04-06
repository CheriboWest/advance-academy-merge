'use client'

import type { DreamCompanyInput, DreamCompanyResult } from '@/types/dream-company'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'

export async function generateDreamCompanies(profile: DreamCompanyInput): Promise<DreamCompanyResult> {
  return fetchJson<DreamCompanyResult>('/api/dream-company/generate', {
    method: 'POST',
    body: JSON.stringify({ profile }),
    timeoutMs: 120000,
  })
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

  return fetchFormDataJson<CVParseResponse>('/api/dream-company/parse-cv', formData, { timeoutMs: 120000 })
}
