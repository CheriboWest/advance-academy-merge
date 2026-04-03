import { useState, useCallback } from 'react'
import type { CvTabName, CVReview } from '@/lib/types'
import { MOCK_CV_REVIEW } from '@/lib/mock-data'

export function useCvOptimizer() {
  const [tab, setTab] = useState<CvTabName>('analysis')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<CVReview | null>(null)

  const upload = useCallback(() => {
    setLoading(true)
    setTimeout(() => {
      setResults(MOCK_CV_REVIEW)
      setLoading(false)
    }, 2500)
  }, [])

  const reset = useCallback(() => {
    setResults(null)
    setTab('analysis')
  }, [])

  return { tab, setTab, loading, results, setResults, upload, reset }
}
