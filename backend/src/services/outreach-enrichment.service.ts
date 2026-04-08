import { getExaClient } from '../lib/exa-client.js';
import { isBlockedDomain } from './outreach-extractor.service.js';
import type {
  EnrichmentCard,
  EnrichmentRequest,
  EnrichmentResponse,
} from '../types/outreach.js';

const EXA_OPTIONS = {
  useAutoprompt: true,
  type: "fast"
} as const;

function buildHiringQuery(req: EnrichmentRequest): string {
  return `${req.companyName} ${req.targetRole} currently hiring ${req.experienceLevel}`;
}

function buildSocialQuery(req: EnrichmentRequest): string {
  const personHint = req.personName ? `${req.personName} ` : '';
  return `${req.companyName} ${personHint}${req.targetRole} latest news post interview 2026`;
}

function toCard(result: {
  title: string | null;
  url: string;
  text?: string;
}): EnrichmentCard {
  const exaText = result.text ?? '';
  return {
    title: result.title ?? result.url,
    url: result.url,
    snippet: exaText.slice(0, 150),
    isBlockedDomain: isBlockedDomain(result.url),
    exaText,
  };
}

export async function runEnrichment(req: EnrichmentRequest): Promise<EnrichmentResponse> {
  if (!req.companyName?.trim() || !req.targetRole?.trim() || !req.experienceLevel) {
    const err = new Error('Enrichment requires companyName, targetRole, and experienceLevel.');
    Object.assign(err, { statusCode: 400 });
    throw err;
  }

  const exa = getExaClient();

  try {
    const [hiringResponse, socialResponse] = await Promise.all([
      exa.searchAndContents(buildHiringQuery(req), EXA_OPTIONS),
      exa.searchAndContents(buildSocialQuery(req), EXA_OPTIONS),
    ]);

    return {
      hiringResults: hiringResponse.results.map(toCard),
      socialResults: socialResponse.results.map(toCard),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Exa search failed';
    const wrapped = new Error(`Exa enrichment failed: ${message}`);
    Object.assign(wrapped, { statusCode: 502 });
    throw wrapped;
  }
}
