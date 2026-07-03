'use client'

import { useState, useRef, useCallback } from 'react'
import type {
  DreamCompanyInput,
  ProfileAnalysis,
  TargetRole,
  ExaJobListing,
  CareerRoadmap,
} from '@/types/dream-company'
import { analyzeProfileStream, generateRolesStream, generateRoadmapStream, parseCV } from '@/features/dream-company/api/frontend-client'

// Rough per-step output sizes (chars of streamed JSON) used to turn the live token stream into
// a progress %. Approximate on purpose — the bar caps at 96% and snaps to 100 only on completion.
const EXPECTED_CHARS = { analyze: 2200, roles: 2600, roadmap: 3200 } as const

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
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [roadmap, setRoadmap] = useState<CareerRoadmap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<DreamCompanyStep>('idle')
  const [progress, setProgress] = useState(0)

  const profileRef = useRef<DreamCompanyInput | null>(null)
  const charsRef = useRef(0)

  // Begin a streamed step: reset the progress bar and return an onDelta that advances it as
  // tokens arrive (capped at 96% until the step's `done` result lands).
  const beginStep = useCallback((expected: number) => {
    charsRef.current = 0
    setProgress(0)
    return (text: string) => {
      charsRef.current += text.length
      setProgress(Math.min(96, Math.round((charsRef.current / expected) * 100)))
    }
  }, [])

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
        // Step 1: Profile Analysis (streamed)
        const analysisResult = await analyzeProfileStream(profile, beginStep(EXPECTED_CHARS.analyze))
        setAnalysis(analysisResult)
        setCurrentStep('generating-roles')

        // Step 2: Target Roles (streamed)
        const rolesResult = await generateRolesStream(profile, analysisResult, beginStep(EXPECTED_CHARS.roles))
        setRoles(rolesResult)
        setCurrentStep('picking')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setCurrentStep('idle')
      } finally {
        setProgress(0)
        setLoading(false)
      }
    },
    [beginStep],
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
      setJobsError(null)
      setCurrentStep('building-roadmap')

      try {
        // Step 3: Exa job search + Roadmap (streamed)
        const result = await generateRoadmapStream(profile, analysis, selectedRoles, beginStep(EXPECTED_CHARS.roadmap))
        setJobs(result.jobs)
        setJobsError(result.jobsError)
        setRoadmap(result.roadmap)
        setCurrentStep('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setCurrentStep('picking')
      } finally {
        setProgress(0)
        setLoading(false)
      }
    },
    [analysis, selectedRoles, beginStep],
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
    setJobsError(null)
    setRoadmap(null)
    setLoading(false)
    setError(null)
    setCurrentStep('idle')
    setProgress(0)
  }, [])

  return {
    analysis,
    roles,
    selectedRoles,
    jobs,
    jobsError,
    roadmap,
    loading,
    error,
    currentStep,
    progress,
    generateFromProfile,
    toggleRole,
    buildRoadmap,
    uploadCV,
    reset,
  }
}
