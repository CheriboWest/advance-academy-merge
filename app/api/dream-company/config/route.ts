import { getProxyAuthToken } from '@/shared/api/proxy-auth'
import { NextResponse } from 'next/server'
import { getDreamCompanyConfigFromBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

// Read-only config for the Dream Company FE (the role-selection cap). Single source of
// truth is the backend (JOB_MAX_ROLE_QUERIES), so a Railway env change updates the FE
// limit without a frontend deploy.
export async function GET(request: Request) {
  try {
    const authToken = getProxyAuthToken(request)
    const response = await getDreamCompanyConfigFromBackend(authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to load Dream Company config.' },
      { status: 500 },
    )
  }
}
