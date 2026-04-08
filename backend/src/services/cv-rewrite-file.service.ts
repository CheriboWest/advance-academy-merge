import PizZip from 'pizzip';
import type { RewriteSuggestion } from '@advance-academy/contracts/cv-optimizer';

export interface RewriteFileResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
  appliedCount: number;
  totalCount: number;
}

function encodeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

interface TextNode {
  matchStart: number;
  matchEnd: number;
  attrs: string;
  text: string;
}

/**
 * Best-effort find-and-replace inside a DOCX `word/document.xml`. Walks every
 * `<w:t>` text run, builds a concatenated string, locates each suggestion's
 * `current` text and rewrites the affected runs in place. Formatting of the
 * first affected run is preserved; if a match crosses runs, the trailing runs
 * are emptied (Word will continue to use the first run's formatting).
 */
function applyRewritesToDocumentXml(
  xml: string,
  suggestions: RewriteSuggestion[],
): { xml: string; appliedCount: number } {
  const re = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const nodes: TextNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    nodes.push({
      matchStart: m.index,
      matchEnd: m.index + m[0].length,
      attrs: m[1] ?? '',
      text: decodeXml(m[2]),
    });
  }

  if (nodes.length === 0) {
    return { xml, appliedCount: 0 };
  }

  const offsets = nodes.map(() => ({ start: 0, end: 0 }));
  const rebuildConcat = (): string => {
    let concat = '';
    for (let i = 0; i < nodes.length; i++) {
      offsets[i].start = concat.length;
      offsets[i].end = concat.length + nodes[i].text.length;
      concat += nodes[i].text;
    }
    return concat;
  };

  let concat = rebuildConcat();
  let appliedCount = 0;

  for (const sug of suggestions) {
    const original = sug.current?.trim();
    const suggested = sug.suggested ?? '';
    if (!original) continue;

    let idx = concat.indexOf(original);
    let matchLen = original.length;

    if (idx === -1) {
      // Fallback: collapse whitespace on both sides and try again. We then
      // map the normalized index back by walking the original concat.
      const collapse = (s: string) => s.replace(/\s+/g, ' ');
      const normConcat = collapse(concat);
      const normOriginal = collapse(original);
      const normIdx = normConcat.indexOf(normOriginal);
      if (normIdx === -1) continue;

      // Map normIdx → idx in the un-normalized concat.
      let raw = 0;
      let norm = 0;
      let prevWs = false;
      let mappedStart = -1;
      while (raw < concat.length) {
        if (norm === normIdx && mappedStart === -1) {
          mappedStart = raw;
          break;
        }
        const ch = concat[raw];
        const isWs = /\s/.test(ch);
        if (isWs) {
          if (!prevWs) norm += 1;
          prevWs = true;
        } else {
          norm += 1;
          prevWs = false;
        }
        raw += 1;
      }
      if (mappedStart === -1) continue;
      // Walk forward to cover normOriginal length in normalized space.
      let rawEnd = mappedStart;
      let normCount = 0;
      prevWs = false;
      while (rawEnd < concat.length && normCount < normOriginal.length) {
        const ch = concat[rawEnd];
        const isWs = /\s/.test(ch);
        if (isWs) {
          if (!prevWs) normCount += 1;
          prevWs = true;
        } else {
          normCount += 1;
          prevWs = false;
        }
        rawEnd += 1;
      }
      idx = mappedStart;
      matchLen = rawEnd - mappedStart;
    }

    const matchStart = idx;
    const matchEnd = idx + matchLen;

    let firstAffected = -1;
    let lastAffected = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (offsets[i].end > matchStart && offsets[i].start < matchEnd) {
        if (firstAffected === -1) firstAffected = i;
        lastAffected = i;
      }
    }
    if (firstAffected === -1) continue;

    const before = nodes[firstAffected].text.slice(0, matchStart - offsets[firstAffected].start);
    const after = nodes[lastAffected].text.slice(matchEnd - offsets[lastAffected].start);

    if (firstAffected === lastAffected) {
      nodes[firstAffected].text = before + suggested + after;
    } else {
      nodes[firstAffected].text = before + suggested;
      for (let i = firstAffected + 1; i < lastAffected; i++) {
        nodes[i].text = '';
      }
      nodes[lastAffected].text = after;
    }

    appliedCount += 1;
    concat = rebuildConcat();
  }

  if (appliedCount === 0) {
    return { xml, appliedCount: 0 };
  }

  // Rebuild the XML by replacing each `<w:t>` block from end → start to keep
  // earlier offsets valid. Always emit `xml:space="preserve"` so leading or
  // trailing whitespace in the rewritten text isn't collapsed by Word.
  let result = xml;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    let attrs = n.attrs;
    if (!/xml:space\s*=/.test(attrs)) {
      attrs = `${attrs} xml:space="preserve"`;
    }
    const replacement = `<w:t${attrs}>${encodeXml(n.text)}</w:t>`;
    result = result.slice(0, n.matchStart) + replacement + result.slice(n.matchEnd);
  }
  return { xml: result, appliedCount };
}

export function applyRewritesToDocx(
  buffer: Buffer,
  suggestions: RewriteSuggestion[],
): { buffer: Buffer; appliedCount: number } {
  const zip = new PizZip(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw Object.assign(new Error('Invalid DOCX: missing word/document.xml'), { statusCode: 422 });
  }
  const xml = documentFile.asText();
  const { xml: rewritten, appliedCount } = applyRewritesToDocumentXml(xml, suggestions);
  zip.file('word/document.xml', rewritten);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer: out, appliedCount };
}

export function generateRewrittenCvFile(
  originalBuffer: Buffer,
  originalFilename: string,
  suggestions: RewriteSuggestion[],
): RewriteFileResult {
  const lower = originalFilename.toLowerCase();
  const total = suggestions.length;

  if (lower.endsWith('.docx')) {
    const { buffer, appliedCount } = applyRewritesToDocx(originalBuffer, suggestions);
    const baseName = originalFilename.replace(/\.docx$/i, '');
    return {
      buffer,
      filename: `${baseName}-improved.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      appliedCount,
      totalCount: total,
    };
  }

  if (lower.endsWith('.pdf')) {
    throw Object.assign(
      new Error(
        'In-place PDF rewriting is not supported. Please re-upload your CV as a .docx file to download an improved version with original formatting.',
      ),
      { statusCode: 415 },
    );
  }

  throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
}
