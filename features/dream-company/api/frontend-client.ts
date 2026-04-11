'use client'

import type { DreamCompanyInput, ProfileAnalysis, TargetRole, RoadmapResponse } from '@/types/dream-company'
import { fetchFormDataJson, fetchJson } from '@/shared/api/http-client'

export async function analyzeProfile(profile: DreamCompanyInput): Promise<ProfileAnalysis> {
  return fetchJson<ProfileAnalysis>('/api/dream-company/analyze', {
    method: 'POST',
    body: JSON.stringify({ profile }),
    timeoutMs: 60000,
  })
}

export async function generateRoles(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
): Promise<TargetRole[]> {
  return fetchJson<TargetRole[]>('/api/dream-company/roles', {
    method: 'POST',
    body: JSON.stringify({ profile, analysis }),
    timeoutMs: 60000,
  })
}

export async function generateRoadmap(
  profile: DreamCompanyInput,
  analysis: ProfileAnalysis,
  selectedRoles: TargetRole[],
): Promise<RoadmapResponse> {
  return fetchJson<RoadmapResponse>('/api/dream-company/roadmap', {
    method: 'POST',
    body: JSON.stringify({ profile, analysis, selectedRoles }),
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
