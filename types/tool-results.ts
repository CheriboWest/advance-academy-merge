// Tool run history (sprint F5).
// Mirrors the backend shapes returned by GET /api/tool-results.

export type ToolName = 'cv' | 'dream' | 'interview'

export interface ToolResultSummary {
  id: string
  tool: ToolName
  /** Short label, e.g. "Data Analyst · London". */
  input_summary: string | null
  created_at: string
}

export interface ToolResultDetail extends ToolResultSummary {
  /** The tool's stored output. Shape depends on `tool`. */
  result: unknown
}

export interface ToolResultsListResponse {
  results: ToolResultSummary[]
  count: number
}

export interface ToolResultDetailResponse {
  result: ToolResultDetail
}

export interface ToolResultsFilters {
  tool?: string
  limit?: number
}

export const TOOL_LABELS: Record<ToolName, string> = {
  cv: 'CV Optimiser',
  dream: 'Dream Company',
  interview: 'Interview Lab',
}
