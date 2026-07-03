import { proxyStream } from '@/shared/api/stream-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: Request) {
  return proxyStream(request, '/api/dream-company/analyze/stream')
}
