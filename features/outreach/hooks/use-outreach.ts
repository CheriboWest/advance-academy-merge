'use client'

import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  EnrichmentRequest,
  EnrichmentResponse,
  OutreachRequest,
  OutreachResult,
} from '@/types/outreach'
import type { OutreachFormData } from '@/features/outreach/types'
import { HttpClientError } from '@/shared/api/http-client'
import {
  submitOutreachEnrichment,
  submitOutreachGeneration,
} from '@/features/outreach/api/frontend-client'

const INITIAL_FORM: OutreachFormData = {
  cvText: '',
  portfolioUrl: '',
  portfolioText: '',
  targetCompany: '',
  targetPersonName: '',
  targetRole: '',
  experienceLevel: 'mid',
  intent: 'direct_application',
  selectedHiringCard: null,
  selectedSocialCard: null,
  outputs: { email: true, linkedIn: true },
  enrichmentResults: null,
}

function buildGenerateRequest(form: OutreachFormData): OutreachRequest {
  return {
    cvText: form.cvText,
    portfolioText: form.portfolioText.trim() ? form.portfolioText : undefined,
    targetCompany: form.targetCompany,
    targetPersonName: form.targetPersonName.trim() ? form.targetPersonName : undefined,
    targetRole: form.targetRole,
    experienceLevel: form.experienceLevel,
    intent: form.intent,
    hiringSignalUrl: form.selectedHiringCard?.url,
    hiringSignalExaText: form.selectedHiringCard?.exaText,
    socialSignalUrl: form.selectedSocialCard?.url,
    socialSignalExaText: form.selectedSocialCard?.exaText,
    outputs: form.outputs,
  }
}

function buildEnrichRequest(form: OutreachFormData): EnrichmentRequest {
  return {
    companyName: form.targetCompany.trim(),
    targetRole: form.targetRole.trim(),
    experienceLevel: form.experienceLevel,
    personName: form.targetPersonName.trim() || undefined,
  }
}

export function useOutreach() {
  const [form, setForm] = useState<OutreachFormData>(INITIAL_FORM)
  const [results, setResults] = useState<OutreachResult | null>(null)

  const generateMutation = useMutation<OutreachResult, HttpClientError, OutreachRequest>({
    mutationFn: submitOutreachGeneration,
    onSuccess: (data) => {
      setResults(data)
    },
  })

  const enrichMutation = useMutation<EnrichmentResponse, HttpClientError, EnrichmentRequest>({
    mutationFn: submitOutreachEnrichment,
    onSuccess: (data) => {
      setForm((prev) => ({
        ...prev,
        enrichmentResults: data,
        // Reset selections when fresh results come in
        selectedHiringCard: null,
        selectedSocialCard: null,
      }))
    },
  })

  const updateForm = useCallback(
    (updates: Partial<OutreachFormData> | ((prev: OutreachFormData) => Partial<OutreachFormData>)) => {
      setForm((previous) => {
        const next = typeof updates === 'function' ? updates(previous) : updates
        return { ...previous, ...next }
      })
    },
    [],
  )

  const enrich = useCallback(() => {
    if (!form.targetCompany.trim() || !form.targetRole.trim()) return
    enrichMutation.mutate(buildEnrichRequest(form))
  }, [form, enrichMutation])

  const generate = useCallback(() => {
    generateMutation.mutate(buildGenerateRequest(form))
  }, [form, generateMutation])

  const reset = useCallback(() => {
    setResults(null)
    generateMutation.reset()
  }, [generateMutation])

  return {
    form,
    updateForm,
    results,
    setResults,
    loading: generateMutation.isPending,
    error: generateMutation.error?.payload?.message ?? generateMutation.error?.message ?? null,
    generate,
    reset,
    enrich,
    enriching: enrichMutation.isPending,
    enrichError: enrichMutation.error?.payload?.message ?? enrichMutation.error?.message ?? null,
  }
}
