import type { ApiErrorResponse } from '@advance-academy/contracts'

export interface FeatureResultState<T> {
  status: 'idle' | 'submitting' | 'running' | 'completed' | 'failed'
  data: T | null
  error: ApiErrorResponse | null
}
