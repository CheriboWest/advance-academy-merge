import { useState, useCallback } from 'react'
import type { CompanyFormData, CompanyResult } from '@/lib/types'
import { MOCK_COMPANIES } from '@/lib/mock-data'

export function useDreamCompany() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<CompanyFormData>({
    industry: '',
    location: '',
    companySize: ''
  })
  const [results, setResults] = useState<CompanyResult[] | null>(null)
  const [loading, setLoading] = useState(false)

  const updateForm = useCallback((updates: Partial<CompanyFormData>) => {
    setForm(prev => ({ ...prev, ...updates }))
  }, [])

  const search = useCallback(() => {
    if (form.industry && form.location && form.companySize) {
      setLoading(true)
      setTimeout(() => {
        setResults(MOCK_COMPANIES)
        setLoading(false)
      }, 2500)
    }
  }, [form.industry, form.location, form.companySize])

  const reset = useCallback(() => {
    setStep(1)
    setResults(null)
  }, [])

  return { step, setStep, form, updateForm, results, loading, search, reset }
}
