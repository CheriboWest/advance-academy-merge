import { useState, useCallback } from 'react'
import type { OutreachFormData, OutreachScript } from '@/lib/types'
import { MOCK_SCRIPTS } from '@/lib/mock-data'

export function useOutreach() {
  const [form, setForm] = useState<OutreachFormData>({
    jobTitle: '',
    company: ''
  })
  const [results, setResults] = useState<OutreachScript[] | null>(null)
  const [loading, setLoading] = useState(false)

  const updateForm = useCallback((updates: Partial<OutreachFormData>) => {
    setForm(prev => ({ ...prev, ...updates }))
  }, [])

  const generate = useCallback(() => {
    if (form.jobTitle && form.company) {
      setLoading(true)
      setTimeout(() => {
        setResults(MOCK_SCRIPTS)
        setLoading(false)
      }, 2500)
    }
  }, [form.jobTitle, form.company])

  const reset = useCallback(() => {
    setResults(null)
  }, [])

  return { form, updateForm, results, setResults, loading, generate, reset }
}
