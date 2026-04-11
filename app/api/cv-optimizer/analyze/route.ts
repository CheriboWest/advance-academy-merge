import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { analyzeCvSchema } from '@/features/cv-optimizer/schemas/cv-optimizer'
import { analyzeCvWithBackend } from '@/shared/api/backend-client'
import { HttpClientError } from '@/shared/api/http-client'

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const payload = analyzeCvSchema.parse(json)
    const response = await analyzeCvWithBackend(payload)

    return NextResponse.json(response, { status: 202 })
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => i.message).join(' ')
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: message || 'Please fill in the required fields.',
          details: {
            fieldErrors: error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        },
        { status: 400 },
      )
    }

    if (error instanceof HttpClientError) {
      return NextResponse.json(error.payload, { status: error.status || 500 })
    }

    return NextResponse.json(
      {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid request body.',
      },
      { status: 400 },
    )
  }
}
