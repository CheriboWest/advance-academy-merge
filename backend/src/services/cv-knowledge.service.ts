/**
 * CV Knowledge Base service.
 * Pure functions; no HTTP. Orchestrates Anthropic + Supabase + Voyage.
 *
 * Key design: cv_bullets belong to a USER (bullet pool), not a CV version.
 * The junction table cv_version_bullets links versions to their bullets.
 * This allows the same bullet (with its gaps + artifacts) to be shared
 * across multiple CV versions.
 */
import { extractTextFromFile, extractTextFromUrl } from './outreach-extractor.service.js';
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { getSupabase, getMvpUserId } from '../lib/supabase.js';
import { embedText, embedTexts, isVoyageConfigured } from '../lib/voyage.js';
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
  SimilarBulletCandidate,
  ParsedBulletWithCandidates,
  CvUploadPhase1Response,
  BulletResolution,
  CvFinalizeResponse,
} from '../types/cv-knowledge.js';

const MAX_GAPS = 5;

function cleanJson(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
}

async function llmJson<T = unknown>(systemOrUser: string, userMaybe?: string): Promise<T> {
  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
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

// ── Phase 1: Parse CV → return bullets + similarity candidates ──────────────

export async function parseCvVersion(args: {
  name: string;
  rawText: string;
  sourceFilePath?: string | null;
}): Promise<CvUploadPhase1Response> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  // Insert the cv_version row
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

  // Extract bullets + detect field via LLM
  const parsed = await llmJson<{
    detected_field: DetectedField;
    bullets: Array<{ section_path: string | null; bullet_text: string }>;
  }>(buildBulletExtractionPrompt(args.rawText));

  const bullets = (parsed.bullets ?? []).filter((b) => b.bullet_text?.trim());
  const detectedField = parsed.detected_field ?? null;

  if (detectedField) {
    await supabase.from('cv_versions').update({ detected_field: detectedField }).eq('id', cvVersionId);
  }

  // For each parsed bullet, find similar existing bullets in the user's pool
  const parsedBullets: ParsedBulletWithCandidates[] = [];
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    const tempId = `temp_${i}`;
    let candidates: SimilarBulletCandidate[] = [];
    try {
      candidates = await findSimilarBullets(userId, b.bullet_text.trim(), 5);
    } catch (err) {
      console.error('[cv-knowledge] similarity search failed for bullet', i, err);
    }
    parsedBullets.push({
      tempId,
      bulletText: b.bullet_text.trim(),
      sectionPath: b.section_path ?? null,
      candidates,
    });
  }

  return { cvVersionId, detectedField, parsedBullets };
}

export async function parseCvVersionFromFile(
  name: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<CvUploadPhase1Response> {
  const rawText = await extractTextFromFile(fileBuffer, fileName.toLowerCase());
  return parseCvVersion({ name, rawText });
}

// ── Phase 2: Finalize — user has resolved each bullet (merge or new) ────────

export async function finalizeCvBullets(
  cvVersionId: string,
  parsedBullets: ParsedBulletWithCandidates[],
  resolutions: BulletResolution[],
): Promise<CvFinalizeResponse> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  // Look up detected field for gap generation prompts
  const { data: cvRow } = await supabase
    .from('cv_versions')
    .select('detected_field')
    .eq('id', cvVersionId)
    .single();
  const detectedField = (cvRow?.detected_field as DetectedField) ?? null;

  const resMap = new Map(resolutions.map((r) => [r.tempId, r]));
  let newBulletCount = 0;
  let mergedBulletCount = 0;
  let totalGaps = 0;

  // Batch embed all "new" bullets at once to minimize Voyage calls
  const newBullets = parsedBullets.filter((b) => {
    const res = resMap.get(b.tempId);
    return !res || res.action === 'new';
  });
  let embeddings: number[][] = [];
  if (newBullets.length > 0 && isVoyageConfigured()) {
    try {
      embeddings = await embedTexts(
        newBullets.map((b) => b.bulletText),
        'document',
      );
    } catch (err) {
      console.error('[cv-knowledge] batch embed failed', err);
    }
  }
  let embedIdx = 0;

  for (let i = 0; i < parsedBullets.length; i++) {
    const pb = parsedBullets[i];
    const res = resMap.get(pb.tempId);
    const action = res?.action ?? 'new';

    if (action === 'merge' && res?.existingBulletId) {
      // Link existing bullet to this CV version
      await supabase.from('cv_version_bullets').upsert(
        {
          cv_version_id: cvVersionId,
          bullet_id: res.existingBulletId,
          ordinal: i,
          section_path: pb.sectionPath,
        },
        { onConflict: 'cv_version_id,bullet_id' },
      );
      mergedBulletCount++;
    } else {
      // Create a new bullet in the user's pool
      const embedding = embeddings[embedIdx] ?? null;
      embedIdx++;

      const { data: newBullet, error: bulletErr } = await supabase
        .from('cv_bullets')
        .insert({
          user_id: userId,
          cv_version_id: cvVersionId,
          section_path: pb.sectionPath,
          bullet_text: pb.bulletText,
          ordinal: i,
          bullet_embedding: embedding ? `[${embedding.join(',')}]` : null,
        })
        .select('id')
        .single();
      if (bulletErr || !newBullet) {
        console.error('[cv-knowledge] failed to insert bullet', bulletErr);
        continue;
      }
      newBulletCount++;

      // Junction row
      await supabase.from('cv_version_bullets').insert({
        cv_version_id: cvVersionId,
        bullet_id: newBullet.id,
        ordinal: i,
        section_path: pb.sectionPath,
      });

      // Generate gaps for new bullet
      try {
        const gapResp = await llmJson<{
          gaps: Array<{ question: string; rationale?: string }>;
        }>(buildGapPrompt(pb.bulletText, pb.sectionPath, detectedField));
        const gapItems = (gapResp.gaps ?? []).slice(0, MAX_GAPS);
        if (gapItems.length > 0) {
          const { error: gapErr } = await supabase.from('bullet_gaps').insert(
            gapItems.map((g, gi) => ({
              bullet_id: newBullet.id,
              question: g.question,
              rationale: g.rationale ?? null,
              ordinal: gi + 1,
              status: 'open',
            })),
          );
          if (!gapErr) totalGaps += gapItems.length;
        }
      } catch (err) {
        console.error('[cv-knowledge] gap gen failed for bullet', newBullet.id, err);
      }
    }
  }

  return {
    bulletCount: parsedBullets.length,
    newBulletCount,
    mergedBulletCount,
    gapCount: totalGaps,
  };
}

// ── Legacy one-shot upload (for backward compat — auto-creates all as new) ──

export async function createCvVersionFromText(args: {
  name: string;
  rawText: string;
  sourceFilePath?: string | null;
}): Promise<{ cvVersionId: string; bulletCount: number; gapCount: number }> {
  const phase1 = await parseCvVersion(args);
  const resolutions: BulletResolution[] = phase1.parsedBullets.map((b) => ({
    tempId: b.tempId,
    action: 'new',
  }));
  const result = await finalizeCvBullets(phase1.cvVersionId, phase1.parsedBullets, resolutions);
  return {
    cvVersionId: phase1.cvVersionId,
    bulletCount: result.bulletCount,
    gapCount: result.gapCount,
  };
}

export async function createCvVersionFromFile(
  name: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ cvVersionId: string; bulletCount: number; gapCount: number }> {
  const rawText = await extractTextFromFile(fileBuffer, fileName.toLowerCase());
  return createCvVersionFromText({ name, rawText });
}

// ── Similarity search ───────────────────────────────────────────────────────

export async function findSimilarBullets(
  userId: string,
  bulletText: string,
  limit: number = 5,
): Promise<SimilarBulletCandidate[]> {
  const embedding = await embedText(bulletText, 'query');
  if (!embedding) return [];

  const supabase = getSupabase();

  // pgvector cosine distance query
  const embeddingStr = `[${embedding.join(',')}]`;
  const { data, error } = await supabase.rpc('match_bullets', {
    query_embedding: embeddingStr,
    match_user_id: userId,
    match_count: limit,
  });

  if (error) {
    // Fallback: if RPC doesn't exist yet, try raw query via REST
    console.error('[cv-knowledge] match_bullets RPC failed, trying direct query', error);
    return findSimilarBulletsDirect(userId, embeddingStr, limit);
  }

  return (data ?? []).map((row: any) => ({
    bulletId: row.id,
    bulletText: row.bullet_text,
    sectionPath: row.section_path ?? null,
    similarity: row.similarity ?? 0,
    gapCount: row.gap_count ?? 0,
    answeredGapCount: row.answered_gap_count ?? 0,
  }));
}

async function findSimilarBulletsDirect(
  userId: string,
  embeddingStr: string,
  limit: number,
): Promise<SimilarBulletCandidate[]> {
  const supabase = getSupabase();

  // Direct query: filter by user, order by cosine similarity
  const { data: bullets } = await supabase
    .from('cv_bullets')
    .select('id, bullet_text, section_path')
    .eq('user_id', userId)
    .not('bullet_embedding', 'is', null)
    .limit(200);

  if (!bullets || bullets.length === 0) return [];

  // Without RPC we can't do ORDER BY <=> in the supabase-js client.
  // Return all user bullets and let the caller pick. For MVP scale (<500) this is fine.
  // Enrich with gap counts.
  const result: SimilarBulletCandidate[] = [];
  for (const b of bullets.slice(0, limit * 2)) {
    const { count: gapCount } = await supabase
      .from('bullet_gaps')
      .select('id', { count: 'exact', head: true })
      .eq('bullet_id', b.id);
    const { count: answeredCount } = await supabase
      .from('bullet_gaps')
      .select('id', { count: 'exact', head: true })
      .eq('bullet_id', b.id)
      .eq('status', 'answered');
    result.push({
      bulletId: b.id,
      bulletText: b.bullet_text,
      sectionPath: b.section_path ?? null,
      similarity: 0, // can't compute without RPC
      gapCount: gapCount ?? 0,
      answeredGapCount: answeredCount ?? 0,
    });
  }
  return result.slice(0, limit);
}

// ── Merge bullets ───────────────────────────────────────────────────────────

export async function mergeBullets(sourceBulletId: string, targetBulletId: string): Promise<void> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  // Verify both belong to the same user
  const { data: src } = await supabase
    .from('cv_bullets')
    .select('id, user_id')
    .eq('id', sourceBulletId)
    .eq('user_id', userId)
    .single();
  const { data: tgt } = await supabase
    .from('cv_bullets')
    .select('id, user_id')
    .eq('id', targetBulletId)
    .eq('user_id', userId)
    .single();
  if (!src || !tgt) {
    throw Object.assign(new Error('Bullet not found or not owned by user'), { statusCode: 404 });
  }

  // Find the max ordinal on the target bullet's gaps so we can avoid conflicts
  const { data: maxRow } = await supabase
    .from('bullet_gaps')
    .select('ordinal')
    .eq('bullet_id', targetBulletId)
    .order('ordinal', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrdinal = (maxRow?.ordinal ?? 0) + 1;

  // Get source gaps and re-parent them
  const { data: sourceGaps } = await supabase
    .from('bullet_gaps')
    .select('id')
    .eq('bullet_id', sourceBulletId)
    .order('ordinal', { ascending: true });

  for (const gap of sourceGaps ?? []) {
    await supabase
      .from('bullet_gaps')
      .update({ bullet_id: targetBulletId, ordinal: nextOrdinal })
      .eq('id', gap.id);
    nextOrdinal++;
  }

  // Re-parent junction rows
  const { data: junctions } = await supabase
    .from('cv_version_bullets')
    .select('id, cv_version_id')
    .eq('bullet_id', sourceBulletId);

  for (const j of junctions ?? []) {
    // Check if target already linked to this version
    const { data: existing } = await supabase
      .from('cv_version_bullets')
      .select('id')
      .eq('cv_version_id', j.cv_version_id)
      .eq('bullet_id', targetBulletId)
      .maybeSingle();
    if (existing) {
      // Already linked — just delete the source junction
      await supabase.from('cv_version_bullets').delete().eq('id', j.id);
    } else {
      await supabase
        .from('cv_version_bullets')
        .update({ bullet_id: targetBulletId })
        .eq('id', j.id);
    }
  }

  // Delete the source bullet (now orphaned — no gaps, no junctions)
  await supabase.from('cv_bullets').delete().eq('id', sourceBulletId);
}

// ── Backfill embeddings ─────────────────────────────────────────────────────

export async function backfillEmbeddings(): Promise<{ updated: number }> {
  if (!isVoyageConfigured()) return { updated: 0 };
  const supabase = getSupabase();
  const { data: bullets } = await supabase
    .from('cv_bullets')
    .select('id, bullet_text')
    .is('bullet_embedding', null)
    .limit(128);
  if (!bullets || bullets.length === 0) return { updated: 0 };

  const texts = bullets.map((b) => b.bullet_text);
  const embeddings = await embedTexts(texts, 'document');

  let updated = 0;
  for (let i = 0; i < bullets.length; i++) {
    if (!embeddings[i]) continue;
    const { error } = await supabase
      .from('cv_bullets')
      .update({ bullet_embedding: `[${embeddings[i].join(',')}]` })
      .eq('id', bullets[i].id);
    if (!error) updated++;
  }
  return { updated };
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
    // Count bullets via junction table
    const { count: bulletCount } = await supabase
      .from('cv_version_bullets')
      .select('id', { count: 'exact', head: true })
      .eq('cv_version_id', row.id);

    // Open gaps for bullets in this version
    const { data: junctions } = await supabase
      .from('cv_version_bullets')
      .select('bullet_id')
      .eq('cv_version_id', row.id);
    let openGapCount = 0;
    if (junctions && junctions.length > 0) {
      const ids = junctions.map((j) => j.bullet_id);
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
  // Deleting the version cascades to cv_version_bullets junction rows only.
  // The actual bullets (and their gaps/artifacts) survive if linked to other versions.
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

// ── Bullets + gaps + artifacts (read for UI) — now via junction ──────────────

export async function listBulletsWithGaps(cvVersionId: string): Promise<BulletWithGaps[]> {
  const supabase = getSupabase();

  // Join through the junction table
  const { data: junctions, error } = await supabase
    .from('cv_version_bullets')
    .select('bullet_id, ordinal, section_path')
    .eq('cv_version_id', cvVersionId)
    .order('ordinal', { ascending: true });
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });

  const result: BulletWithGaps[] = [];
  for (const j of junctions ?? []) {
    const { data: bullet } = await supabase
      .from('cv_bullets')
      .select('id, bullet_text')
      .eq('id', j.bullet_id)
      .single();
    if (!bullet) continue;

    const { data: gaps } = await supabase
      .from('bullet_gaps')
      .select('id, question, rationale, ordinal, status')
      .eq('bullet_id', bullet.id)
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
      id: bullet.id,
      sectionPath: j.section_path,
      bulletText: bullet.bullet_text,
      ordinal: j.ordinal,
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
    if (!rawText) throw Object.assign(new Error('Empty artifact text'), { statusCode: 400 });
  } else if (payload.sourceType === 'url') {
    sourceUrl = payload.url.trim();
    rawText = await extractTextFromUrl(sourceUrl);
  } else {
    rawText = await extractTextFromFile(payload.buffer, payload.fileName.toLowerCase());
    sourceFilePath = payload.fileName;
  }

  let summary: ArtifactSummary | null = null;
  if (rawText.length > 80) {
    try {
      summary = await llmJson<ArtifactSummary>(buildArtifactSummaryPrompt(rawText, gap.question));
    } catch (err) {
      console.error('[cv-knowledge] summary failed', err);
    }
  } else {
    summary = { overview: rawText, my_contribution: '', concrete_facts: [rawText], metrics: [] };
  }

  const { error: insertErr } = await supabase.from('bullet_artifacts').insert({
    gap_id: gapId,
    source_type: payload.sourceType,
    content_text: rawText.slice(0, 20000),
    source_url: sourceUrl,
    source_file_path: sourceFilePath,
    summary_json: summary,
  });
  if (insertErr) throw Object.assign(new Error(insertErr.message), { statusCode: 500 });

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

export async function recordJitClarification(args: {
  bulletId: string | null;
  question: string;
  answer: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!args.bulletId || args.bulletId === 'none') return;

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

// ── Pick relevant bullets — now queries the ENTIRE user pool ────────────────

export async function getRelevantBulletsForQuestion(
  _cvVersionId: string,
  interviewQuestion: string,
): Promise<CvBulletRow[]> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  // Query ALL bullets for the user (the whole pool), not just one CV version
  const { data: bullets } = await supabase
    .from('cv_bullets')
    .select('id, cv_version_id, section_path, bullet_text, ordinal, created_at')
    .eq('user_id', userId)
    .order('ordinal', { ascending: true });
  if (!bullets || bullets.length === 0) return [];

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

// Fetch artifacts (their summary_json) for a list of bullets — unchanged
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
