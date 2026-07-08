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
// a progress %. Approximate on purpose — the bar follows a saturating curve toward a per-run
// ceiling (randomised each step, see `beginStep`) and only snaps away on completion.
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
  const [jobsNotice, setJobsNotice] = useState<string | null>(null)
  const [roadmap, setRoadmap] = useState<CareerRoadmap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<DreamCompanyStep>('idle')
  const [progress, setProgress] = useState(0)

  const profileRef = useRef<DreamCompanyInput | null>(null)
  const charsRef = useRef(0)
  const ceilingRef = useRef(96)

  // Begin a streamed step: reset the bar and return an onDelta that advances it as tokens arrive.
  // Instead of a hard 96% cap that freezes on the same number every run, the bar follows the real
  // streamed volume through a saturating curve `ceiling * (1 - e^(-k·ratio))` toward a per-run
  // ceiling randomised to 93–98%. It keeps inching (never flat-lines) and lands on a different
  // final number each time, then the next step / completion clears it.
  const beginStep = useCallback((expected: number) => {
    charsRef.current = 0
    ceilingRef.current = 93 + Math.floor(Math.random() * 6) // 93..98, varies each run
    setProgress(0)
    return (text: string) => {
      charsRef.current += text.length
      const ratio = charsRef.current / expected
      setProgress(Math.round(ceilingRef.current * (1 - Math.exp(-1.8 * ratio))))
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
      setJobsNotice(null)
      setCurrentStep('building-roadmap')

      try {
        // Step 3: live job search + Roadmap (streamed)
        const result = await generateRoadmapStream(profile, analysis, selectedRoles, beginStep(EXPECTED_CHARS.roadmap))
        setJobs(result.jobs)
        setJobsError(result.jobsError)
        setJobsNotice(result.jobsNotice)
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
    setJobsNotice(null)
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
    jobsNotice,
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
