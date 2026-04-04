import type { OutreachRequest, OutreachResult } from '../../types/outreach.js';
import { extractProfileSignals } from './extractProfileSignals.js';
import { generateLinkedInMessage } from './generateLinkedInMessage.js';
import { generateEmail } from './generateEmail.js';
import { generateRecruiterPitch } from './generateRecruiterPitch.js';

export async function generateOutreach(request: OutreachRequest): Promise<OutreachResult> {
  const senderSignal = await extractProfileSignals(request.rawProfile);

  const [linkedInMessage, email, recruiterPitch] = await Promise.all([
    generateLinkedInMessage(senderSignal, request.targetData, request.roleData),
    generateEmail(senderSignal, request.targetData, request.roleData),
    generateRecruiterPitch(senderSignal, request.recruiterData, request.desiredRole),
  ]);

  return {
    senderSignal,
    linkedInMessage,
    email,
    recruiterPitch,
  };
}
