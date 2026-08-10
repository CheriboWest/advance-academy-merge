/**
 * Candidate Acquisition — admin lead-list types (CA-001).
 *
 * These now live in `packages/contracts` alongside the CSV builder, so the
 * Fastify route and this screen cannot disagree about the shape or about which
 * columns an export carries. Re-exported here to keep the existing
 * `@/types/leads` import path working.
 */
export type {
  Contactability,
  LeadRow,
  LeadsFilters,
  LeadsListResponse,
} from '@advance-academy/contracts/leads'
