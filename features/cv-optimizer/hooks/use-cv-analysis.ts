'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { AnalyzeCvRequest, AnalyzeCvResult, JobStatusResponse } from '@advance-academy/contracts'
import { HttpClientError } from '@/shared/api/http-client'
import type { FeatureResultState } from '@/shared/types/feature'
import { getCvAnalysisJob, submitCvAnalysis } from '@/features/cv-optimizer/api/frontend-client'
import { getClientEnv } from '@/shared/env/client'

const STORAGE_KEY = 'advance-academy.cv-optimizer.job-id'

function readStoredJobId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(STORAGE_KEY)
}

function clearStoredJobId() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function storeJobId(jobId: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, jobId)
  }
}

export function useSubmitCvAnalysis() {
  return useMutation<Awaited<ReturnType<typeof submitCvAnalysis>>, HttpClientError, AnalyzeCvRequest>({
    mutationFn: submitCvAnalysis,
  })
}

export function useCvAnalysisJob(jobId: string | null) {
  const { cvAnalysisPollIntervalMs } = getClientEnv()

  return useQuery<JobStatusResponse<AnalyzeCvResult>, HttpClientError>({
    queryKey: ['cv-optimizer', 'job', jobId],
    queryFn: () => getCvAnalysisJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const response = query.state.data as JobStatusResponse<AnalyzeCvResult> | undefined

      return response && (response.status === 'completed' || response.status === 'failed')
        ? false
        : cvAnalysisPollIntervalMs
    },
    retry: 1,
  })
}

export type CvOptimizerTab = 'analysis' | 'keywords' | 'ats' | 'bullets' | 'rewrite' | 'expert'

export function useCvOptimizer() {
  const [tab, setTab] = useState<CvOptimizerTab>('analysis')
  const [jobId, setJobId] = useState<string | null>(null)
  const submitMutation = useSubmitCvAnalysis()
  const jobQuery = useCvAnalysisJob(jobId)

  useEffect(() => {
    setJobId(readStoredJobId())
  }, [])

  useEffect(() => {
    if (submitMutation.data?.jobId) {
      storeJobId(submitMutation.data.jobId)
      setJobId(submitMutation.data.jobId)
    }
  }, [submitMutation.data?.jobId])

  const state = useMemo<FeatureResultState<AnalyzeCvResult>>(() => {
    if (submitMutation.isPending) {
      return { status: 'submitting', data: null, error: null }
    }

    if (jobQuery.data?.status === 'completed') {
      return {
        status: 'completed',
        data: jobQuery.data.result ?? null,
        error: null,
      }
    }

    if (jobQuery.data?.status === 'failed') {
      return {
        status: 'failed',
        data: null,
        error: jobQuery.data.error ?? {
          code: 'JOB_FAILED',
          message: 'The CV analysis job failed.',
        },
      }
    }

    if (submitMutation.isError) {
      return {
        status: 'failed',
        data: null,
        error: submitMutation.error.payload,
      }
    }

    if (jobQuery.isError) {
      return {
        status: 'failed',
        data: null,
        error: jobQuery.error.payload,
      }
    }

    if (jobId || jobQuery.data?.status === 'running' || jobQuery.data?.status === 'queued') {
      return {
        status: 'running',
        data: null,
        error: null,
      }
    }

    return {
      status: 'idle',
      data: null,
      error: null,
    }
  }, [jobId, jobQuery.data, jobQuery.error, jobQuery.isError, submitMutation.error, submitMutation.isError, submitMutation.isPending])

  useEffect(() => {
    if (state.status === 'completed' || state.status === 'failed') {
      clearStoredJobId()
    }
  }, [state.status])

  function submit(values: AnalyzeCvRequest) {
    setTab('analysis')
    submitMutation.mutate(values)
  }

  function reset() {
    clearStoredJobId()
    setJobId(null)
    setTab('analysis')
    submitMutation.reset()
  }

  return {
    tab,
    setTab,
    jobId,
    submit,
    reset,
    state,
    latestJob: jobQuery.data ?? null,
  }
}
