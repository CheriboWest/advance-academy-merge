'use client'

import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { OutreachRequest, OutreachResult } from '@/types/outreach'
import type { OutreachFormData } from '@/features/outreach/types'
import { HttpClientError } from '@/shared/api/http-client'
import { submitOutreachGeneration } from '@/features/outreach/api/frontend-client'

const INITIAL_FORM: OutreachFormData = {
  headline: '',
  about: '',
  experience: [{ title: '', company: '', description: '', duration: '' }],
  skills: [],
  posts: [],

  targetName: '',
  targetRole: '',
  targetCompany: '',
  targetIndustry: '',
  recentActivity: '',
  whyThisCompany: '',
  companySignal: '',
  hiringManager: '',
  hiringManagerRole: '',

  roleTitle: '',
  department: '',
  keyRequirements: [],
  impliedPain: '',

  recruiterName: '',
  recruiterType: 'agency',
  specialization: '',
  activeRoles: [],

  desiredTitle: '',
  desiredLocation: '',
  salaryExpectation: '',
}

function buildRequest(form: OutreachFormData): OutreachRequest {
  return {
    rawProfile: {
      headline: form.headline,
      about: form.about,
      experience: form.experience.filter((e) => e.title || e.company),
      skills: form.skills.filter(Boolean),
      posts: form.posts.filter(Boolean),
    },
    targetData: {
      name: form.targetName,
      role: form.targetRole,
      company: form.targetCompany,
      industry: form.targetIndustry,
      recentActivity: form.recentActivity || undefined,
      whyThisCompany: form.whyThisCompany,
      companySignal: form.companySignal || undefined,
      hiringManager: form.hiringManager || undefined,
      hiringManagerRole: form.hiringManagerRole || undefined,
    },
    roleData: {
      title: form.roleTitle,
      department: form.department,
      keyRequirements: form.keyRequirements.filter(Boolean),
      impliedPain: form.impliedPain,
    },
    recruiterData: {
      name: form.recruiterName,
      type: form.recruiterType,
      specialization: form.specialization,
      activeRoles: form.activeRoles.filter(Boolean),
    },
    desiredRole: {
      title: form.desiredTitle,
      location: form.desiredLocation,
      salaryExpectation: form.salaryExpectation || undefined,
    },
  }
}

export function useOutreach() {
  const [form, setForm] = useState<OutreachFormData>(INITIAL_FORM)
  const [results, setResults] = useState<OutreachResult | null>(null)

  const mutation = useMutation<OutreachResult, HttpClientError, OutreachRequest>({
    mutationFn: submitOutreachGeneration,
    onSuccess: (data) => {
      setResults(data)
    },
  })

  const updateForm = useCallback((updates: Partial<OutreachFormData>) => {
    setForm((previous) => ({ ...previous, ...updates }))
  }, [])

  const generate = useCallback(() => {
    const request = buildRequest(form)
    mutation.mutate(request)
  }, [form, mutation])

  const reset = useCallback(() => {
    setResults(null)
    mutation.reset()
  }, [mutation])

  return {
    form,
    updateForm,
    results,
    setResults,
    loading: mutation.isPending,
    error: mutation.error?.payload?.message ?? mutation.error?.message ?? null,
    generate,
    reset,
  }
}
