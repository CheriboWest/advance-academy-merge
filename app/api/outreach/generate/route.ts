import { NextResponse } from 'next/server';
import type { OutreachRequest } from '@/types/outreach';
import { generateOutreach } from '@/lib/outreach/generateOutreach';

export async function POST(request: Request) {
  let body: OutreachRequest;

  try {
    const json = await request.json();

    if (
      !json.rawProfile ||
      !json.targetData ||
      !json.roleData ||
      !json.recruiterData ||
      !json.desiredRole
    ) {
      return NextResponse.json(
        {
          error:
            'Missing required fields: rawProfile, targetData, roleData, recruiterData, desiredRole',
        },
        { status: 400 },
      );
    }

    body = json as OutreachRequest;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 },
    );
  }

  try {
    const result = await generateOutreach(body);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Outreach generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
