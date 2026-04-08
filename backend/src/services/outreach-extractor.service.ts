import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const BLOCKED_DOMAINS = ['linkedin.com', 'facebook.com'];
const EXTRACT_MAX_CHARS = 1200;

export function isBlockedDomain(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function extractContent(targetUrl: string, exaText?: string): Promise<string> {
  if (isBlockedDomain(targetUrl)) {
    return (exaText ?? '').slice(0, EXTRACT_MAX_CHARS);
  }

  try {
    const text = await extractTextFromUrl(targetUrl);
    return text.slice(0, EXTRACT_MAX_CHARS);
  } catch {
    // Fall back to Exa text if Jina fails and we happen to have it
    return (exaText ?? '').slice(0, EXTRACT_MAX_CHARS);
  }
}

export async function extractTextFromFile(buffer: Buffer, fileNameLower: string): Promise<string> {
  const isPdf = fileNameLower.endsWith('.pdf');
  const isDocx = fileNameLower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw Object.assign(new Error('Only PDF and DOCX files are supported'), { statusCode: 400 });
  }

  let extractedText: string;

  if (isPdf) {
    const pdfData = await pdfParse(buffer);
    extractedText = pdfData.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    extractedText = result.value;
  }

  if (!extractedText.trim()) {
    throw Object.assign(new Error('Could not extract text from the uploaded file'), { statusCode: 422 });
  }

  return extractedText.trim();
}

export async function extractTextFromUrl(targetUrl: string): Promise<string> {
  const jinaKey = process.env.JINA_API_KEY?.trim();

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (jinaKey) {
    headers['Authorization'] = `Bearer ${jinaKey}`;
  }

  // Add x-return-format if necessary, but Accept JSON usually defaults to markdown inside "content"
  try {
    const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      throw new Error(`Jina API failed with status ${res.status}`);
    }

    // Jina returns a JSON object when requested with Accept: json
    // Format: { data: { title: string, content: string, url: string } }
    const data = await res.json() as any;
    const content = data?.data?.content || data?.text || data?.content;

    if (!content) {
      throw new Error('No content returned from URL');
    }

    return content.trim();
  } catch (err: any) {
    throw Object.assign(new Error(`Failed to extract URL: ${err.message}`), { statusCode: 500 });
  }
}
