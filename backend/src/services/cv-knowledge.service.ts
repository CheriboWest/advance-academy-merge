/**
 * CV Knowledge Base service.
 * Pure functions; no HTTP. Orchestrates Anthropic + Supabase.
 */
import { extractTextFromFile, extractTextFromUrl } from './outreach-extractor.service.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { getSupabase, getMvpUserId } from '../lib/supabase.js';
import {
  buildBulletExtractionPrompt,
  buildGapPrompt,
  buildArtifactSummaryPrompt,
  buildBulletRelevancePrompt,
} from '../lib/cv-knowledge/prompts.js';
import type {
  ArtifactSummary,
  BulletWithGaps,
  CvVersionRow,
  CvVersionSummary,
  DetectedField,
  CvBulletRow,
} from '../types/cv-knowledge.js';

const MAX_GAPS = 5;

function cleanJson(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
}

async function llmJson<T = unknown>(systemOrUser: string, userMaybe?: string): Promise<T> {
  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient();
  const model = getFeatureModel('interviewPrep');
  const isPair = userMaybe !== undefined;
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: isPair ? systemOrUser : 'You return only valid JSON.',
    messages: [{ role: 'user', content: isPair ? userMaybe! : systemOrUser }],
  });
  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw Object.assign(new Error('LLM returned no text'), { statusCode: 502 });
  }
  try {
    return JSON.parse(cleanJson(block.text)) as T;
  } catch {
    throw Object.assign(new Error('Failed to parse LLM JSON'), { statusCode: 502 });
  }
}

// ── Create CV version (text already extracted) ──────────────────────────────

export async function createCvVersionFromText(args: {
  name: string;
  rawText: string;
  sourceFilePath?: string | null;
}): Promise<{ cvVersionId: string; bulletCount: number; gapCount: number }> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  const { data: inserted, error } = await supabase
    .from('cv_versions')
    .insert({
      user_id: userId,
      name: args.name,
      raw_text: args.rawText,
      source_file_path: args.sourceFilePath ?? null,
      is_active: false,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    throw Object.assign(new Error(`Failed to create cv_version: ${error?.message}`), { statusCode: 500 });
  }
  const cvVersionId = inserted.id as string;

  // 1. Extract bullets + detect field
  const parsed = await llmJson<{
    detected_field: DetectedField;
    bullets: Array<{ section_path: string | null; bullet_text: string }>;
  }>(buildBulletExtractionPrompt(args.rawText));

  const bullets = (parsed.bullets ?? []).filter((b) => b.bullet_text?.trim());

  if (parsed.detected_field) {
    await supabase
      .from('cv_versions')
      .update({ detected_field: parsed.detected_field })
      .eq('id', cvVersionId);
  }

  // 2. Insert bullets
  let bulletRows: Array<{ id: string; bullet_text: string; section_path: string | null }> = [];
  if (bullets.length > 0) {
    const { data: insertedBullets, error: bulletErr } = await supabase
      .from('cv_bullets')
      .insert(
        bullets.map((b, i) => ({
          cv_version_id: cvVersionId,
          section_path: b.section_path ?? null,
          bullet_text: b.bullet_text.trim(),
          ordinal: i,
        })),
      )
      .select('id, bullet_text, section_path');
    if (bulletErr) {
      throw Object.assign(new Error(`Failed to insert bullets: ${bulletErr.message}`), { statusCode: 500 });
    }
    bulletRows = insertedBullets ?? [];
  }

  // 3. Generate gaps for each bullet (sequential — keeps it simple, MVP)
  let totalGaps = 0;
  for (const bullet of bulletRows) {
    try {
      const gapResp = await llmJson<{
        gaps: Array<{ question: string; rationale?: string }>;
      }>(buildGapPrompt(bullet.bullet_text, bullet.section_path, parsed.detected_field));
      const gapItems = (gapResp.gaps ?? []).slice(0, MAX_GAPS);
      if (gapItems.length === 0) continue;
      const { error: gapErr } = await supabase.from('bullet_gaps').insert(
        gapItems.map((g, i) => ({
          bullet_id: bullet.id,
          question: g.question,
          rationale: g.rationale ?? null,
          ordinal: i + 1,
          status: 'open',
        })),
      );
      if (!gapErr) totalGaps += gapItems.length;
    } catch (err) {
      // Skip a single bullet's gaps on failure rather than aborting the whole upload
      console.error('[cv-knowledge] gap gen failed for bullet', bullet.id, err);
    }
  }

  return { cvVersionId, bulletCount: bulletRows.length, gapCount: totalGaps };
}

export async function createCvVersionFromFile(
  name: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ cvVersionId: string; bulletCount: number; gapCount: number }> {
  const rawText = await extractTextFromFile(fileBuffer, fileName.toLowerCase());
  return createCvVersionFromText({ name, rawText });
}

// ── List + activate + delete ────────────────────────────────────────────────

export async function listCvVersions(): Promise<CvVersionSummary[]> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { data, error } = await supabase
    .from('cv_versions')
    .select('id, name, detected_field, is_active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });

  const summaries: CvVersionSummary[] = [];
  for (const row of data ?? []) {
    const { count: bulletCount } = await supabase
      .from('cv_bullets')
      .select('id', { count: 'exact', head: true })
      .eq('cv_version_id', row.id);

    // open gaps = gaps for bullets in this CV with status 'open'
    const { data: bulletIds } = await supabase
      .from('cv_bullets')
      .select('id')
      .eq('cv_version_id', row.id);
    let openGapCount = 0;
    if (bulletIds && bulletIds.length > 0) {
      const ids = bulletIds.map((b) => b.id);
      const { count } = await supabase
        .from('bullet_gaps')
        .select('id', { count: 'exact', head: true })
        .in('bullet_id', ids)
        .eq('status', 'open');
      openGapCount = count ?? 0;
    }

    summaries.push({
      id: row.id,
      name: row.name,
      detectedField: row.detected_field ?? null,
      isActive: row.is_active,
      bulletCount: bulletCount ?? 0,
      openGapCount,
      createdAt: row.created_at,
    });
  }
  return summaries;
}

export async function activateCvVersion(cvVersionId: string): Promise<void> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  // Clear current active first to avoid the partial unique index conflict.
  const { error: clearErr } = await supabase
    .from('cv_versions')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (clearErr) throw Object.assign(new Error(clearErr.message), { statusCode: 500 });
  const { error } = await supabase
    .from('cv_versions')
    .update({ is_active: true })
    .eq('id', cvVersionId)
    .eq('user_id', userId);
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
}

export async function deleteCvVersion(cvVersionId: string): Promise<void> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { error } = await supabase
    .from('cv_versions')
    .delete()
    .eq('id', cvVersionId)
    .eq('user_id', userId);
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
}

export async function getCvVersion(id: string): Promise<CvVersionRow | null> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { data } = await supabase
    .from('cv_versions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as CvVersionRow | null) ?? null;
}

export async function getActiveCvVersion(): Promise<CvVersionRow | null> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { data } = await supabase
    .from('cv_versions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as CvVersionRow | null) ?? null;
}

// ── Bullets + gaps + artifacts (read for UI) ────────────────────────────────

export async function listBulletsWithGaps(cvVersionId: string): Promise<BulletWithGaps[]> {
  const supabase = getSupabase();
  const { data: bullets, error } = await supabase
    .from('cv_bullets')
    .select('id, section_path, bullet_text, ordinal')
    .eq('cv_version_id', cvVersionId)
    .order('ordinal', { ascending: true });
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });

  const result: BulletWithGaps[] = [];
  for (const b of bullets ?? []) {
    const { data: gaps } = await supabase
      .from('bullet_gaps')
      .select('id, question, rationale, ordinal, status')
      .eq('bullet_id', b.id)
      .order('ordinal', { ascending: true });

    const gapShapes = [];
    for (const g of gaps ?? []) {
      const { data: artifacts } = await supabase
        .from('bullet_artifacts')
        .select('id, source_type, content_text, source_url, summary_json, created_at')
        .eq('gap_id', g.id)
        .order('created_at', { ascending: true });
      gapShapes.push({
        id: g.id,
        question: g.question,
        rationale: g.rationale,
        ordinal: g.ordinal,
        status: g.status,
        artifacts: (artifacts ?? []).map((a) => ({
          id: a.id,
          sourceType: a.source_type,
          contentText: a.content_text,
          sourceUrl: a.source_url,
          summary: a.summary_json,
          createdAt: a.created_at,
        })),
      });
    }
    result.push({
      id: b.id,
      sectionPath: b.section_path,
      bulletText: b.bullet_text,
      ordinal: b.ordinal,
      gaps: gapShapes,
    });
  }
  return result;
}

// ── Add an artifact to a gap (text/file/url) ────────────────────────────────

export async function addArtifactToGap(
  gapId: string,
  payload:
    | { sourceType: 'text'; text: string }
    | { sourceType: 'url'; url: string }
    | { sourceType: 'file'; buffer: Buffer; fileName: string }
    | { sourceType: 'jit_clarification'; text: string },
): Promise<void> {
  const supabase = getSupabase();

  // Look up the gap's question to bias the summarizer.
  const { data: gap, error: gapErr } = await supabase
    .from('bullet_gaps')
    .select('id, question')
    .eq('id', gapId)
    .single();
  if (gapErr || !gap) {
    throw Object.assign(new Error('Gap not found'), { statusCode: 404 });
  }

  let rawText: string;
  let sourceUrl: string | null = null;
  let sourceFilePath: string | null = null;

  if (payload.sourceType === 'text' || payload.sourceType === 'jit_clarification') {
    rawText = payload.text.trim();
    if (!rawText) {
      throw Object.assign(new Error('Empty artifact text'), { statusCode: 400 });
    }
  } else if (payload.sourceType === 'url') {
    sourceUrl = payload.url.trim();
    rawText = await extractTextFromUrl(sourceUrl);
  } else {
    rawText = await extractTextFromFile(payload.buffer, payload.fileName.toLowerCase());
    sourceFilePath = payload.fileName;
  }

  // Summarize-with-quotes (skip for very short text, e.g. JIT one-liners)
  let summary: ArtifactSummary | null = null;
  if (rawText.length > 80) {
    try {
      summary = await llmJson<ArtifactSummary>(
        buildArtifactSummaryPrompt(rawText, gap.question),
      );
    } catch (err) {
      console.error('[cv-knowledge] summary failed', err);
    }
  } else {
    // Treat short answers (e.g. "team of 5") as a one-liner concrete fact.
    summary = {
      overview: rawText,
      my_contribution: '',
      concrete_facts: [rawText],
      metrics: [],
    };
  }

  const { error: insertErr } = await supabase.from('bullet_artifacts').insert({
    gap_id: gapId,
    source_type: payload.sourceType,
    content_text: rawText.slice(0, 20000),
    source_url: sourceUrl,
    source_file_path: sourceFilePath,
    summary_json: summary,
  });
  if (insertErr) {
    throw Object.assign(new Error(insertErr.message), { statusCode: 500 });
  }

  await supabase
    .from('bullet_gaps')
    .update({ status: 'answered', updated_at: new Date().toISOString() })
    .eq('id', gapId);
}

export async function skipGap(gapId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('bullet_gaps')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('id', gapId);
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
}

// ── JIT clarification writeback ─────────────────────────────────────────────
// Called by the coach-answer flow when the user fills in a placeholder during
// an interview. If we know the bulletId, attach the answer as an artifact on
// a synthetic gap (creating one if needed).

export async function recordJitClarification(args: {
  bulletId: string | null;
  question: string;
  answer: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!args.bulletId || args.bulletId === 'none') {
    // No bullet to attach to → record nothing for v1. (Could be a "loose facts" pool later.)
    return;
  }

  // Find or create a gap on this bullet matching the question.
  const { data: existing } = await supabase
    .from('bullet_gaps')
    .select('id, ordinal')
    .eq('bullet_id', args.bulletId)
    .eq('question', args.question)
    .maybeSingle();

  let gapId: string;
  if (existing) {
    gapId = existing.id as string;
  } else {
    // Insert with next ordinal (don't enforce 5-cap on JIT-created gaps for v1).
    const { data: maxRow } = await supabase
      .from('bullet_gaps')
      .select('ordinal')
      .eq('bullet_id', args.bulletId)
      .order('ordinal', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrdinal = (maxRow?.ordinal ?? 0) + 1;
    const { data: created, error } = await supabase
      .from('bullet_gaps')
      .insert({
        bullet_id: args.bulletId,
        question: args.question,
        ordinal: nextOrdinal,
        status: 'open',
      })
      .select('id')
      .single();
    if (error || !created) {
      throw Object.assign(new Error(error?.message ?? 'Failed to create gap'), { statusCode: 500 });
    }
    gapId = created.id as string;
  }

  await addArtifactToGap(gapId, { sourceType: 'jit_clarification', text: args.answer });
}

// ── Pick relevant bullets for an interview question ─────────────────────────

export async function getRelevantBulletsForQuestion(
  cvVersionId: string,
  interviewQuestion: string,
): Promise<CvBulletRow[]> {
  const supabase = getSupabase();
  const { data: bullets } = await supabase
    .from('cv_bullets')
    .select('id, cv_version_id, section_path, bullet_text, ordinal, created_at')
    .eq('cv_version_id', cvVersionId)
    .order('ordinal', { ascending: true });
  if (!bullets || bullets.length === 0) return [];

  // For very small CVs, just return everything — saves an LLM call.
  if (bullets.length <= 4) return bullets as CvBulletRow[];

  try {
    const ranked = await llmJson<{ bulletIds: string[] }>(
      buildBulletRelevancePrompt(
        interviewQuestion,
        bullets.map((b) => ({ id: b.id, section: b.section_path, text: b.bullet_text })),
      ),
    );
    const idSet = new Set(ranked.bulletIds ?? []);
    const picked = bullets.filter((b) => idSet.has(b.id));
    return (picked.length > 0 ? picked : bullets.slice(0, 3)) as CvBulletRow[];
  } catch {
    return bullets.slice(0, 3) as CvBulletRow[];
  }
}

// Fetch artifacts (their summary_json) for a list of bullets
export async function getArtifactsForBullets(
  bulletIds: string[],
): Promise<Map<string, ArtifactSummary[]>> {
  const supabase = getSupabase();
  const result = new Map<string, ArtifactSummary[]>();
  if (bulletIds.length === 0) return result;
  const { data: gaps } = await supabase
    .from('bullet_gaps')
    .select('id, bullet_id')
    .in('bullet_id', bulletIds);
  if (!gaps || gaps.length === 0) return result;
  const gapToBullet = new Map<string, string>(gaps.map((g) => [g.id, g.bullet_id]));
  const { data: artifacts } = await supabase
    .from('bullet_artifacts')
    .select('gap_id, summary_json')
    .in('gap_id', gaps.map((g) => g.id));
  for (const a of artifacts ?? []) {
    if (!a.summary_json) continue;
    const bulletId = gapToBullet.get(a.gap_id);
    if (!bulletId) continue;
    const list = result.get(bulletId) ?? [];
    list.push(a.summary_json as ArtifactSummary);
    result.set(bulletId, list);
  }
  return result;
}
