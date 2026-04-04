import type { OutreachRequest, OutreachResult } from '@/types/outreach';
import { extractProfileSignals } from '@/lib/outreach/extractProfileSignals';
import { generateLinkedInMessage } from '@/lib/outreach/generateLinkedInMessage';
import { generateEmail } from '@/lib/outreach/generateEmail';
import { generateRecruiterPitch } from '@/lib/outreach/generateRecruiterPitch';

export async function generateOutreach(
  request: OutreachRequest,
): Promise<OutreachResult> {
  const senderSignal = await extractProfileSignals(request.rawProfile);

  const [linkedInMessage, email, recruiterPitch] = await Promise.all([
    generateLinkedInMessage(senderSignal, request.targetData, request.roleData),
    generateEmail(senderSignal, request.targetData, request.roleData),
    generateRecruiterPitch(
      senderSignal,
      request.recruiterData,
      request.desiredRole,
    ),
  ]);

  return {
    senderSignal,
    linkedInMessage,
    email,
    recruiterPitch,
  };
}
