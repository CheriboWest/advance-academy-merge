/**
 * Generates a markdown "AI Coach Understanding" report from the user's entire
 * bullet pool, gaps, and artifacts.
 */
import { assertLlmConfigured, createAnthropicClient, getFeatureModel } from '../lib/llm-anthropic.js';
import { getSupabase, getMvpUserId } from '../lib/supabase.js';

const SYSTEM_PROMPT = `You are an expert career coach reviewing a candidate's self-reported background data.
You will receive:
1. A list of CV bullet points (the user's entire experience pool across all CV versions).
2. For each bullet, a list of "gap questions" an interviewer would ask, and whether the user has answered each gap.
3. For answered gaps, the evidence/artifact the user provided.

Your job: write a comprehensive markdown report titled "## AI Coach's Understanding of Your Background".

The report MUST include these sections in order:

### 1. Profile Summary
Write 2-3 paragraphs summarizing who this person is based on the data. Mention their apparent seniority, domain(s), key skills, and career trajectory. Only state what the data supports.

### 2. Strongest Evidence Areas
List the bullet points where the user has filled the most gaps with concrete, detailed evidence. For each, explain what the coach now understands well enough to craft a strong interview answer. Use specific facts from the artifacts.

### 3. Knowledge Gaps & Blind Spots
For each UNANSWERED gap (status = "open"), infer what this silence might mean:
- The user may lack quantifiable impact data for that experience.
- The user may not have reflected on their specific contribution.
- The user may have forgotten details or considers them unimportant.
List each unanswered gap with its parent bullet, and provide a brief assessment of what the coach CANNOT help with until this gap is filled. Be direct but constructive.

### 4. Potential Duplicate Bullet Points
Look for bullet points that describe the SAME project, role, or achievement using different wording (e.g. from different CV versions). List each suspected duplicate pair with:
- The two bullet texts side by side
- Why you think they're duplicates
- A recommendation: "Consider merging these in the CV Library so your evidence is consolidated in one place."
If no duplicates are found, say so explicitly.

### 5. Recommendations
Prioritized list of 3-5 actions the user should take to strengthen their interview prep:
- Which gaps to fill first (highest interview impact)
- Which bullets to merge
- What types of evidence are still missing (metrics, tech details, impact numbers, etc.)

FORMATTING RULES:
- Use markdown headings, bullet lists, and bold for emphasis.
- Be specific — cite actual bullet text and gap questions, not vague summaries.
- Do NOT invent facts. If the user didn't provide data, say "not provided" rather than guessing.`;

interface BulletData {
  id: string;
  bulletText: string;
  sectionPath: string | null;
  gaps: Array<{
    question: string;
    status: string;
    artifacts: Array<{ contentText: string | null; sourceType: string }>;
  }>;
}

function buildUserPrompt(bullets: BulletData[]): string {
  if (bullets.length === 0) {
    return 'The user has no bullet points in their CV Library yet. Generate a short report explaining that the coach has no data to work with and the user should upload a CV first.';
  }

  const sections = bullets.map((b, i) => {
    const gapLines = b.gaps.map((g) => {
      const statusTag = g.status === 'answered' ? '[ANSWERED]' : g.status === 'skipped' ? '[SKIPPED]' : '[UNANSWERED]';
      const evidence = g.artifacts.length > 0
        ? g.artifacts.map((a) => `      Evidence (${a.sourceType}): ${(a.contentText ?? '').slice(0, 500)}`).join('\n')
        : '      (no evidence provided)';
      return `    - ${statusTag} "${g.question}"\n${evidence}`;
    }).join('\n');

    return `Bullet #${i + 1} [id: ${b.id}]${b.sectionPath ? ` (${b.sectionPath})` : ''}
  "${b.bulletText}"
  Gaps:
${gapLines || '    (no gaps generated)'}`;
  }).join('\n\n');

  return `Here is the user's complete bullet pool with all gaps and evidence:\n\n${sections}`;
}

export async function generateCoachUnderstanding(): Promise<{ reportId: string; reportMd: string }> {
  const supabase = getSupabase();
  const userId = getMvpUserId();

  // Fetch all bullets for the user
  const { data: rawBullets } = await supabase
    .from('cv_bullets')
    .select('id, bullet_text, section_path')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const bullets: BulletData[] = [];
  for (const b of rawBullets ?? []) {
    const { data: gaps } = await supabase
      .from('bullet_gaps')
      .select('id, question, status')
      .eq('bullet_id', b.id)
      .order('ordinal', { ascending: true });

    const gapData = [];
    for (const g of gaps ?? []) {
      const { data: artifacts } = await supabase
        .from('bullet_artifacts')
        .select('content_text, source_type')
        .eq('gap_id', g.id);
      gapData.push({
        question: g.question,
        status: g.status,
        artifacts: (artifacts ?? []).map((a) => ({
          contentText: a.content_text,
          sourceType: a.source_type,
        })),
      });
    }
    bullets.push({
      id: b.id,
      bulletText: b.bullet_text,
      sectionPath: b.section_path,
      gaps: gapData,
    });
  }

  // Call LLM
  assertLlmConfigured('interviewPrep');
  const anthropic = createAnthropicClient('interviewPrep');
  const model = getFeatureModel('interviewPrep');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(bullets) }],
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw Object.assign(new Error('LLM returned no text'), { statusCode: 502 });
  }
  const reportMd = block.text.trim();

  // Persist
  const { data: inserted, error } = await supabase
    .from('coach_understanding_reports')
    .insert({ user_id: userId, report_md: reportMd })
    .select('id')
    .single();
  if (error || !inserted) {
    throw Object.assign(new Error(error?.message ?? 'Failed to save report'), { statusCode: 500 });
  }

  return { reportId: inserted.id as string, reportMd };
}

export async function listCoachReports(): Promise<
  Array<{ id: string; createdAt: string; preview: string }>
> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { data, error } = await supabase
    .from('coach_understanding_reports')
    .select('id, report_md, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    preview: r.report_md.slice(0, 150) + (r.report_md.length > 150 ? '…' : ''),
  }));
}

export async function getCoachReport(id: string): Promise<{ id: string; reportMd: string; createdAt: string } | null> {
  const supabase = getSupabase();
  const userId = getMvpUserId();
  const { data } = await supabase
    .from('coach_understanding_reports')
    .select('id, report_md, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, reportMd: data.report_md, createdAt: data.created_at };
}
