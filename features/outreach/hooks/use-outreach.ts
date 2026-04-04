'use client'

import { useCallback, useState } from 'react'
import type { OutreachFormData, OutreachScript } from '@/lib/types'
import { MOCK_SCRIPTS } from '@/features/outreach/data/mock-scripts'

export function useOutreach() {
  const [form, setForm] = useState<OutreachFormData>({
    jobTitle: '',
    company: '',
  })
  const [results, setResults] = useState<OutreachScript[] | null>(null)
  const [loading, setLoading] = useState(false)

  const updateForm = useCallback((updates: Partial<OutreachFormData>) => {
    setForm((previous) => ({ ...previous, ...updates }))
  }, [])

  const generate = useCallback(() => {
    if (form.jobTitle && form.company) {
      setLoading(true)
      setTimeout(() => {
        setResults(MOCK_SCRIPTS)
        setLoading(false)
      }, 2500)
    }
  }, [form.company, form.jobTitle])

  const reset = useCallback(() => {
    setResults(null)
  }, [])

  return { form, updateForm, results, setResults, loading, generate, reset }
}
