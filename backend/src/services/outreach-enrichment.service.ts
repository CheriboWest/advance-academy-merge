import { getExaClient } from '../lib/exa-client.js';
import { isBlockedDomain } from './outreach-extractor.service.js';
import { rerankCards } from './outreach-rerank.service.js';
import type {
  EnrichmentCard,
  EnrichmentRequest,
  EnrichmentResponse,
} from '../types/outreach.js';

const EXA_OPTIONS = {
  useAutoprompt: true,
  type: "fast"
} as const;

function countrySuffix(req: EnrichmentRequest): string {
  const c = req.targetCountry?.trim();
  return c ? ` in ${c}` : '';
}

function buildHiringQuery(req: EnrichmentRequest): string {
  return `${req.companyName} ${req.targetRole} currently hiring ${req.experienceLevel}${countrySuffix(req)}`;
}

function buildSocialQuery(req: EnrichmentRequest): string {
  const personHint = req.personName ? `${req.personName} ` : '';
  return `${req.companyName} ${personHint}${req.targetRole}${countrySuffix(req)} latest news post interview 2026`;
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

  let hiringRaw: EnrichmentCard[];
  let socialRaw: EnrichmentCard[];

  try {
    const [hiringResponse, socialResponse] = await Promise.all([
      exa.searchAndContents(buildHiringQuery(req), EXA_OPTIONS),
      exa.searchAndContents(buildSocialQuery(req), EXA_OPTIONS),
    ]);

    hiringRaw = hiringResponse.results.map(toCard);
    socialRaw = socialResponse.results.map(toCard);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Exa search failed';
    const wrapped = new Error(`Exa enrichment failed: ${message}`);
    Object.assign(wrapped, { statusCode: 502 });
    throw wrapped;

  }

  // Rerank each category with Claude in parallel. rerankCards() is fail-safe:
  // on any error it returns the original list unchanged.
  const [hiringResults, socialResults] = await Promise.all([
    rerankCards(hiringRaw, 'hiring', req),
    rerankCards(socialRaw, 'social', req),
  ]);

  return { hiringResults, socialResults };
}
