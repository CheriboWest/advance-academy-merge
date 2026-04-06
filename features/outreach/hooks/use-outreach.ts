'use client'

import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { OutreachRequest, OutreachResult } from '@/types/outreach'
import type { OutreachFormData } from '@/features/outreach/types'
import { HttpClientError } from '@/shared/api/http-client'
import { submitOutreachGeneration } from '@/features/outreach/api/frontend-client'

const INITIAL_FORM: OutreachFormData = {
  cvText: '',
  linkedInText: '',
  targetCompany: '',
  targetPersonName: '',
  targetPersonRole: '',
  contextLinks: [],
  intent: 'direct_application',
}

function buildRequest(form: OutreachFormData): OutreachRequest {
  const enrichedContexts = form.contextLinks
    .filter(link => link.status === 'success' && link.extractedText.trim().length > 0)
    .map(link => ({
      type: link.meaning || 'Unknown Context',
      content: link.extractedText,
    }));
    
  return {
    cvText: form.cvText,
    linkedInText: form.linkedInText || undefined,
    targetCompany: form.targetCompany,
    targetPersonName: form.targetPersonName,
    targetPersonRole: form.targetPersonRole || undefined,
    enrichedContexts,
    intent: form.intent,
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

  const updateForm = useCallback((updates: Partial<OutreachFormData> | ((prev: OutreachFormData) => Partial<OutreachFormData>)) => {
    setForm((previous) => {
      const next = typeof updates === 'function' ? updates(previous) : updates;
      return { ...previous, ...next }
    })
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
