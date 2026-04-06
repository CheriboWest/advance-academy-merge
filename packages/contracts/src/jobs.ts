export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ApiErrorResponse {
  code: string
  message: string
  details?: unknown
}

export interface AcceptedJobResponse {
  jobId: string
  status: Extract<JobStatus, 'queued' | 'running'>
  submittedAt: string
  updatedAt: string
}

export interface JobStatusResponse<T> {
  jobId: string
  status: JobStatus
  submittedAt: string
  updatedAt: string
  result?: T
  error?: ApiErrorResponse
}
