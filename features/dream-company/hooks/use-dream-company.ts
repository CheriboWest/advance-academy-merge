'use client'

import { useState, useRef, useCallback } from 'react'
import type {
  DreamCompanyInput,
  ProfileAnalysis,
  TargetRole,
  ExaJobListing,
  CareerRoadmap,
} from '@/types/dream-company'
import { analyzeProfile, generateRoles, generateRoadmap, parseCV } from '@/features/dream-company/api/frontend-client'

export type DreamCompanyStep =
  | 'idle'
  | 'analyzing'
  | 'generating-roles'
  | 'picking'
  | 'building-roadmap'
  | 'done'

export const STEP_LABELS: Record<DreamCompanyStep, string> = {
  idle: '',
  analyzing: 'Analyzing your profile...',
  'generating-roles': 'Finding matching roles...',
  picking: 'Select roles to continue',
  'building-roadmap': 'Searching jobs & building roadmap...',
  done: 'Complete!',
}

export function useDreamCompany() {
  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null)
  const [roles, setRoles] = useState<TargetRole[] | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<TargetRole[]>([])
  const [jobs, setJobs] = useState<ExaJobListing[] | null>(null)
  const [roadmap, setRoadmap] = useState<CareerRoadmap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<DreamCompanyStep>('idle')

  const profileRef = useRef<DreamCompanyInput | null>(null)

  const generateFromProfile = useCallback(
    async (profile: DreamCompanyInput): Promise<void> => {
      profileRef.current = profile
      setLoading(true)
      setError(null)
      setAnalysis(null)
      setRoles(null)
      setSelectedRoles([])
      setJobs(null)
      setRoadmap(null)
      setCurrentStep('analyzing')

      try {
        // Step 1: Profile Analysis
        const analysisResult = await analyzeProfile(profile)
        setAnalysis(analysisResult)
        setCurrentStep('generating-roles')

        // Step 2: Target Roles
        const rolesResult = await generateRoles(profile, analysisResult)
        setRoles(rolesResult)
        setCurrentStep('picking')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setCurrentStep('idle')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const toggleRole = useCallback((role: TargetRole) => {
    setSelectedRoles((prev) => {
      const exists = prev.some((r) => r.title === role.title && r.level === role.level)
      return exists
        ? prev.filter((r) => !(r.title === role.title && r.level === role.level))
        : [...prev, role]
    })
  }, [])

  const buildRoadmap = useCallback(
    async (): Promise<void> => {
      const profile = profileRef.current
      if (!profile || !analysis || selectedRoles.length === 0) return

      setLoading(true)
      setError(null)
      setCurrentStep('building-roadmap')

      try {
        // Step 3: Exa job search + Roadmap
        const result = await generateRoadmap(profile, analysis, selectedRoles)
        setJobs(result.jobs)
        setRoadmap(result.roadmap)
        setCurrentStep('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setCurrentStep('picking')
      } finally {
        setLoading(false)
      }
    },
    [analysis, selectedRoles],
  )

  const uploadCV = useCallback(async (file: File): Promise<DreamCompanyInput | null> => {
    setError(null)

    try {
      const parsed = await parseCV(file)
      return {
        degree: parsed.degree || '',
        workExperience: parsed.workExperience || '',
        skills: parsed.skills || '',
        interests: parsed.interests || '',
        targetSalary: parsed.targetSalary || '',
        location: parsed.location || '',
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CV upload failed')
      return null
    }
  }, [])

  const reset = useCallback(() => {
    profileRef.current = null
    setAnalysis(null)
    setRoles(null)
    setSelectedRoles([])
    setJobs(null)
    setRoadmap(null)
    setLoading(false)
    setError(null)
    setCurrentStep('idle')
  }, [])

  return {
    analysis,
    roles,
    selectedRoles,
    jobs,
    roadmap,
    loading,
    error,
    currentStep,
    generateFromProfile,
    toggleRole,
    buildRoadmap,
    uploadCV,
    reset,
  }
}
