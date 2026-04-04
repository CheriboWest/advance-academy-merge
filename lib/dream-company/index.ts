'use client'

import { useState, useRef, useCallback } from 'react'
import type { DreamCompanyInput, DreamCompanyResult } from '@/types/dream-company'

export type DreamCompanyStep =
  | 'idle'
  | 'analyzing'
  | 'building-matrix'
  | 'finding-roles'
  | 'building-roadmap'
  | 'done'

const STEP_SEQUENCE: DreamCompanyStep[] = [
  'analyzing',
  'building-matrix',
  'finding-roles',
  'building-roadmap',
]

const STEP_LABELS: Record<DreamCompanyStep, string> = {
  idle: '',
  analyzing: 'Analyzing your profile...',
  'building-matrix': 'Building company matrix...',
  'finding-roles': 'Finding target roles...',
  'building-roadmap': 'Building career roadmap...',
  done: 'Complete!',
}

const STEP_INTERVAL_MS = 8000

export { STEP_LABELS }

export function useDreamCompany() {
  const [result, setResult] = useState<DreamCompanyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<DreamCompanyStep>('idle')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearStepTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startStepSimulation = useCallback(() => {
    let stepIndex = 0
    setCurrentStep(STEP_SEQUENCE[0])

    intervalRef.current = setInterval(() => {
      stepIndex++
      if (stepIndex < STEP_SEQUENCE.length) {
        setCurrentStep(STEP_SEQUENCE[stepIndex])
      } else {
        clearStepTimer()
      }
    }, STEP_INTERVAL_MS)
  }, [clearStepTimer])

  const generateFromProfile = useCallback(
    async (profile: DreamCompanyInput): Promise<void> => {
      setLoading(true)
      setError(null)
      setResult(null)

      startStepSimulation()

      try {
        const response = await fetch('/api/dream-company/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Generation failed')
        }

        const data: DreamCompanyResult = await response.json()
        setResult(data)
        setCurrentStep('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setCurrentStep('idle')
      } finally {
        clearStepTimer()
        setLoading(false)
      }
    },
    [startStepSimulation, clearStepTimer]
  )

  const uploadCV = useCallback(async (file: File): Promise<DreamCompanyInput | null> => {
    setError(null)

    try {
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

      const parsed = await response.json()
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
    clearStepTimer()
    setResult(null)
    setLoading(false)
    setError(null)
    setCurrentStep('idle')
  }, [clearStepTimer])

  return {
    result,
    loading,
    error,
    currentStep,
    generateFromProfile,
    uploadCV,
    reset,
  }
}
